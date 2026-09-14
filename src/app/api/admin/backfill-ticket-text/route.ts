/**
 * Repair tickets whose text was thrown away.
 *
 * Until 14 September a ticket raised from a long single-line Slack message had
 * its title cut at 120 characters and its body dropped as a "duplicate" of the
 * untrimmed headline. Ten of the first twenty-two tickets are in that state: a
 * sentence stopping mid-word and no detail anywhere, so the only way to find
 * out what was asked is to go and read Slack — the exact trip a ticket exists
 * to save.
 *
 * The parser is fixed. This repairs what it already broke, by reading each
 * message back from Slack and re-parsing it with the same parseMention the
 * live path now uses, so a repaired ticket is indistinguishable from one filed
 * today.
 *
 * WHY A ROUTE RATHER THAN A SCRIPT. The message text is very likely to contain
 * a patient's name — several of these tickets are about individual patients.
 * Running it here means the text goes Slack → this server → the database and is
 * never printed, pasted through a terminal, or read by anyone doing the repair.
 * The response says how many rows changed and nothing about what they say.
 *
 * Safe to run more than once. It only touches rows that still look broken, and
 * a message Slack can no longer supply is skipped rather than overwritten with
 * nothing — losing the little that survived would be worse than leaving it.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { authorisedCron as authorised } from '@/lib/cron';
import { botUserId, fetchMessageText } from '@/lib/slack/api';
import { parseMention } from '@/lib/slack/mention';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dry') === '1';

  const db = serviceClient();

  /*
   * The signature of the bug: a title the parser cut, and no body. A ticket
   * with a body was never damaged, and one with an untruncated title had
   * nothing to lose.
   */
  const broken = await db
    .from('tech_tickets')
    .select('id, title, slack_channel_id, slack_message_ts')
    .like('title', '%…')
    .is('body', null)
    .not('slack_channel_id', 'is', null)
    .not('slack_message_ts', 'is', null);

  if (broken.error) {
    return NextResponse.json({ error: broken.error.message }, { status: 500 });
  }

  const rows = broken.data ?? [];
  const bot = await botUserId();

  let repaired = 0;
  let unchanged = 0;
  let unavailable = 0;
  const failures: string[] = [];

  for (const row of rows) {
    if (!row.slack_channel_id || !row.slack_message_ts) continue;

    const text = await fetchMessageText(row.slack_channel_id, row.slack_message_ts);

    if (text === null) {
      // Slack could not supply it. Leave the row exactly as it is.
      unavailable += 1;
      continue;
    }

    const draft = parseMention(text, { botUserId: bot });

    /*
     * A parse that yields no title means the message no longer reads as a
     * request — it was edited, or it was only a mention. Skipped rather than
     * blanked.
     */
    if (!draft.title) {
      unavailable += 1;
      continue;
    }

    if (draft.title === row.title && draft.body === null) {
      unchanged += 1;
      continue;
    }

    if (dryRun) {
      repaired += 1;
      continue;
    }

    const written = await db
      .from('tech_tickets')
      .update({ title: draft.title, body: draft.body })
      .eq('id', row.id);

    if (written.error) {
      // The id only. The message is the thing being protected here.
      failures.push(row.id);
      continue;
    }

    repaired += 1;
  }

  return NextResponse.json({
    ok: failures.length === 0,
    dryRun,
    examined: rows.length,
    repaired,
    unchanged,
    unavailable,
    failures,
  });
}
