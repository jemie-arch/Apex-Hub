/**
 * The sweeper that sends the auto-acknowledgement.
 *
 * Runs every minute and asks one question of each watched message: has anybody
 * answered this yet? If not, and the delay has passed, it posts the
 * acknowledgement in the thread and records exactly what it said.
 *
 * WHY A SWEEPER RATHER THAN A REPLY ON RECEIPT
 *
 * The delay is the feature. Replying when the message arrives would beat the
 * notification to the person who should answer it, so the bot would speak
 * first every time and nobody would ever be given the chance to. Two minutes
 * exists to be lost to a human.
 *
 * WHY IT IS SAFE TO RUN OFTEN
 *
 * Every arm of the decision defaults to silence: disabled config, an
 * unconfigured channel list, quiet hours, an unknown thread state, a full rate
 * limit, or a person having replied — each of those leaves the message alone.
 * The one unique index in migration 0046 makes a second reply in the same
 * thread impossible even if two sweeps overlap, which is the ordinary way a
 * watchdog becomes a spammer.
 */
import { NextResponse, type NextRequest } from 'next/server';

import {
  AUTOREPLY_SETTING_KEY,
  isDue,
  isQuietHour,
  parseAutoReplyConfig,
} from '@/config/slack-autoreply';
import { authorisedCron } from '@/lib/cron';
import { humanRepliedInThread, postThreadReply } from '@/lib/slack/api';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Bounded per sweep, so a backlog cannot become a burst. */
const PER_SWEEP = 10;

interface Outcome {
  messageTs: string;
  channel: string;
  result: 'replied' | 'answered' | 'skipped' | 'waiting';
  reason?: string;
}

export async function GET(request: NextRequest) {
  let allowed: boolean;
  try {
    allowed = authorisedCron(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'not configured' },
      { status: 503 },
    );
  }

  if (!allowed) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const db = serviceClient();
  const now = new Date();

  const setting = await db
    .from('app_settings')
    .select('value')
    .eq('key', AUTOREPLY_SETTING_KEY)
    .maybeSingle();

  if (setting.error) throw setting.error;

  const config = parseAutoReplyConfig(setting.data?.value);

  /*
   * Answered honestly rather than as a no-op success. "Off" and "on and
   * nothing to do" look identical in a cron log otherwise, and the first
   * question anybody asks when this appears not to work is which of the two it
   * is in.
   */
  if (!config.enabled) {
    return NextResponse.json({ ok: true, state: 'disabled', replied: 0 });
  }

  if (config.channelIds.length === 0) {
    return NextResponse.json({
      ok: true,
      state: 'no channels configured',
      replied: 0,
    });
  }

  if (isQuietHour(config, now)) {
    /*
     * Left waiting, not skipped. A message that arrives at 23:00 should be
     * acknowledged at 07:00 rather than silently written off — the person who
     * sent it still has not heard anything.
     */
    return NextResponse.json({
      ok: true,
      state: 'quiet hours',
      until: config.quietHoursEnd,
      replied: 0,
    });
  }

  /*
   * The rate limit, counted from what was actually sent rather than from a
   * counter that could drift. Six an hour is enough for a real morning and
   * few enough that a misconfiguration is embarrassing rather than damaging.
   */
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const recent = await db
    .from('slack_watch_messages')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'replied')
    .gte('replied_at', hourAgo);

  if (recent.error) throw recent.error;

  const sentThisHour = recent.count ?? 0;
  if (sentThisHour >= config.maxRepliesPerHour) {
    return NextResponse.json({
      ok: true,
      state: 'rate limited',
      sentThisHour,
      limit: config.maxRepliesPerHour,
      replied: 0,
    });
  }

  const waiting = await db
    .from('slack_watch_messages')
    .select('id, channel_id, thread_ts, message_ts, detected_at')
    .eq('state', 'waiting')
    .in('channel_id', config.channelIds)
    .order('detected_at', { ascending: true })
    .limit(PER_SWEEP);

  if (waiting.error) throw waiting.error;

  const outcomes: Outcome[] = [];
  let budget = config.maxRepliesPerHour - sentThisHour;

  for (const row of waiting.data ?? []) {
    const detectedAt = new Date(row.detected_at);

    if (!isDue(detectedAt, config, now)) {
      outcomes.push({
        messageTs: row.message_ts,
        channel: row.channel_id,
        result: 'waiting',
        reason: 'inside the delay',
      });
      continue;
    }

    /*
     * The question the delay was for. Asked per message and not cached: a
     * person replying between the sweep starting and this row being reached is
     * exactly the case worth losing to.
     */
    const answered = await humanRepliedInThread(row.channel_id, row.thread_ts);

    if (answered === null) {
      // Slack could not be asked. Silence is the only safe answer, and the row
      // stays waiting for the next sweep.
      outcomes.push({
        messageTs: row.message_ts,
        channel: row.channel_id,
        result: 'waiting',
        reason: 'could not read the thread',
      });
      continue;
    }

    if (answered) {
      const marked = await db
        .from('slack_watch_messages')
        .update({ state: 'answered', answered_at: now.toISOString() } as never)
        .eq('id', row.id);
      if (marked.error) throw marked.error;

      outcomes.push({
        messageTs: row.message_ts,
        channel: row.channel_id,
        result: 'answered',
        reason: 'a person got there first',
      });
      continue;
    }

    if (budget <= 0) {
      outcomes.push({
        messageTs: row.message_ts,
        channel: row.channel_id,
        result: 'waiting',
        reason: 'hourly limit reached',
      });
      continue;
    }

    /*
     * Claim the row BEFORE posting.
     *
     * The unique index allows one 'replied' row per thread, so if a concurrent
     * sweep has already claimed this thread the update fails here — before
     * anything reaches Slack. Posting first and recording after is how the same
     * thread gets two acknowledgements when a run overlaps.
     */
    const claimed = await db
      .from('slack_watch_messages')
      .update({
        state: 'replied',
        replied_at: now.toISOString(),
        reply_text: config.template,
      } as never)
      .eq('id', row.id)
      .eq('state', 'waiting')
      .select('id');

    if (claimed.error) {
      outcomes.push({
        messageTs: row.message_ts,
        channel: row.channel_id,
        result: 'skipped',
        reason: 'another sweep has this thread',
      });
      continue;
    }

    if ((claimed.data ?? []).length === 0) {
      outcomes.push({
        messageTs: row.message_ts,
        channel: row.channel_id,
        result: 'skipped',
        reason: 'already claimed',
      });
      continue;
    }

    const posted = await postThreadReply(
      row.channel_id,
      row.thread_ts,
      config.template,
    );

    if (!posted) {
      /*
       * Put it back. The claim is not a record of having spoken, and leaving it
       * as 'replied' after a failed post would mean a message nobody answered
       * and nobody acknowledged, filed as done.
       */
      const released = await db
        .from('slack_watch_messages')
        .update({
          state: 'waiting',
          replied_at: null,
          reply_text: null,
          skip_reason: 'a post to Slack failed; will retry',
        } as never)
        .eq('id', row.id);
      if (released.error) throw released.error;

      outcomes.push({
        messageTs: row.message_ts,
        channel: row.channel_id,
        result: 'waiting',
        reason: 'Slack refused the post',
      });
      continue;
    }

    budget -= 1;
    outcomes.push({
      messageTs: row.message_ts,
      channel: row.channel_id,
      result: 'replied',
    });
  }

  return NextResponse.json({
    ok: true,
    state: 'ran',
    considered: (waiting.data ?? []).length,
    replied: outcomes.filter((entry) => entry.result === 'replied').length,
    answeredByAPerson: outcomes.filter((entry) => entry.result === 'answered').length,
    outcomes,
  });
}
