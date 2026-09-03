/**
 * The @apex ticket bot.
 *
 * Tag @apex in any Slack channel it has been invited to and the message becomes
 * a tech support ticket on the Hub, with a threaded reply saying so.
 *
 * It lands on Ally by default. Tag somebody else in the same message and it
 * lands on them instead — but only a real Slack mention counts, never a name
 * typed as words. lib/slack/assignee carries the reasoning, which is the same
 * reasoning that keeps this route from guessing which practice a ticket is
 * about: a name in prose carries no intent, and "ayanda is out today" must not
 * assign anything to Ayanda.
 *
 * WHY THIS ROUTE IS NOT GUARDED LIKE THE OTHERS
 *
 * Every other machine-to-machine route here checks SERVICE_API_KEY, which works
 * because Make can be told to send an Authorization header. Slack cannot. The
 * request URL is configured once in the Slack app and Slack alone decides what
 * it sends, so the URL is effectively public and the request signature is the
 * authentication. lib/slack/signature carries the detail, including why the raw
 * body has to be read as text before anything parses it.
 *
 * WHY A RETRY CANNOT FILE A SECOND TICKET
 *
 * Slack gives an endpoint three seconds and retries up to three times when it
 * does not answer, and the retry is byte-identical to the original. This route
 * does real work before answering — a users.info call, a permalink call, an
 * insert — and a cold start alone can eat most of the budget, so retries are
 * expected rather than exceptional.
 *
 * Rather than answering 200 immediately and doing the work afterwards, which on
 * a serverless function means the work may simply not happen, the ticket is
 * filed inline and the (slack_channel_id, slack_message_ts) unique index makes
 * the second attempt a no-op: the insert conflicts, the existing ticket is read
 * back, and the retry gets the same answer the first attempt would have given.
 * The bot posts its reply only on the attempt that actually created the row, so
 * three deliveries produce one ticket and one reply.
 *
 * NOT EVERY MENTION IS A REQUEST
 *
 * An announcement about the bot — "for any tech support, please tag @Apex" —
 * used to become a ticket, assigned to Ally, for a message explaining how to
 * file tickets. lib/slack/classify decides; when it declines, the message is
 * kept in tech_ticket_candidates and the thread is told so, and reacting
 * :ticket: promotes it to a real ticket with nothing retyped.
 *
 * Declining fails open everywhere: no API key, a timeout, a malformed answer,
 * all file the ticket. Noise costs a minute; a swallowed request costs work
 * nobody knows is missing.
 *
 * WHAT IT REFUSES TO DO
 *
 * A bare "@apex" with no words after it does not become a ticket. It gets a
 * threaded reply asking what is wrong. The alternative — filing "(no
 * description)" — turns silence into a row somebody has to chase, which is the
 * same mistake the consultation webhook refuses to make with a blank
 * attendance answer.
 *
 * It also never guesses which practice a ticket is about. See lib/slack/mention.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { hubUrl } from '@/lib/app-url';
import { serverEnv, slackSigningSecret } from '@/lib/env';
import { notifyUsers } from '@/lib/notify/inbox';
import {
  addReaction,
  lookupChannelName,
  lookupUser,
  messagePermalink,
  postThreadReply,
} from '@/lib/slack/api';
import { chooseAssignee } from '@/lib/slack/assignee';
import { looksLikeARequest } from '@/lib/slack/classify';
import { parseMention } from '@/lib/slack/mention';
import { verifySlackSignature } from '@/lib/slack/signature';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/** Postgres unique violation. What a Slack retry looks like from the insert. */
const UNIQUE_VIOLATION = '23505';

interface AppMentionEvent {
  type: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  bot_id?: string;
  subtype?: string;
}

/**
 * Who the ticket is assigned to, by email.
 *
 * A miss is not a reason to drop the ticket. An assignee who has left, or a
 * TECH_SUPPORT_ASSIGNEE_EMAIL with a typo in it, must not cost the request —
 * the ticket is filed unassigned and the reply says so out loud, which is a
 * problem somebody can see rather than one that ate their message.
 */
async function resolveAssignee(): Promise<{
  id: string | null;
  name: string | null;
  email: string;
}> {
  const email = serverEnv().TECH_SUPPORT_ASSIGNEE_EMAIL;

  const found = await serviceClient()
    .from('user_profiles')
    .select('id, full_name')
    .ilike('email', email)
    .maybeSingle();

  if (found.error || !found.data) {
    console.error(
      `[slack] no Hub user with email ${email}; ticket will be unassigned`,
    );
    return { id: null, name: null, email };
  }

  return { id: found.data.id, name: found.data.full_name, email };
}

interface ReactionAddedEvent {
  type: string;
  user?: string;
  reaction?: string;
  item?: { type?: string; channel?: string; ts?: string };
}

/** The emoji that overrules a decline. Matches what the decline reply asks for. */
const PROMOTE_REACTION = 'ticket';

/**
 * Somebody reacted :ticket: on a message the classifier declined to file.
 *
 * This is the other half of "never silent". The classifier is allowed to be
 * wrong precisely because being wrong is one click to fix, and the candidate
 * row holds everything the ticket needs — title, body, priority, who it would
 * have gone to — so nothing has to be retyped and no detail is lost in the
 * retelling.
 *
 * The candidate is kept and marked rather than deleted. A run of declines that
 * all got promoted by hand is the evidence that the prompt in classify.ts needs
 * work, and deleting the rows would delete the evidence.
 *
 * Silent about everything it does not recognise. Every reaction in every
 * channel the bot can see arrives here, and the overwhelming majority are
 * people reacting to each other.
 */
async function promoteCandidate(event: ReactionAddedEvent) {
  if (event.reaction !== PROMOTE_REACTION) {
    return NextResponse.json({ ok: true, ignored: 'other reaction' });
  }

  const channelId = event.item?.channel;
  const messageTs = event.item?.ts;

  if (event.item?.type !== 'message' || !channelId || !messageTs) {
    return NextResponse.json({ ok: true, ignored: 'not a message reaction' });
  }

  const db = serviceClient();

  const found = await db
    .from('tech_ticket_candidates')
    .select('*')
    .eq('slack_channel_id', channelId)
    .eq('slack_message_ts', messageTs)
    .maybeSingle();

  if (found.error) {
    console.error('[slack] candidate lookup failed:', found.error.message);
    return NextResponse.json({ ok: false, error: found.error.message });
  }

  /*
   * No candidate means this is an ordinary :ticket: reaction on an ordinary
   * message — including the one the bot adds to every ticket it files, which
   * would otherwise make it react to its own work.
   */
  if (!found.data) {
    return NextResponse.json({ ok: true, ignored: 'no candidate' });
  }

  const candidate = found.data;

  // Two people reacting, or a Slack retry. Either way the first one won.
  if (candidate.promoted_ticket_id !== null) {
    return NextResponse.json({
      ok: true,
      ticketId: candidate.promoted_ticket_id,
      duplicate: true,
    });
  }

  const inserted = await db
    .from('tech_tickets')
    .insert({
      title: candidate.title,
      body: candidate.body,
      priority: candidate.priority,
      assigned_to: candidate.assigned_to,
      raised_by: candidate.raised_by,
      raised_by_name: candidate.raiser_name,
      source: 'slack',
      slack_team_id: candidate.slack_team_id,
      slack_channel_id: candidate.slack_channel_id,
      slack_channel_name: candidate.slack_channel_name,
      slack_message_ts: candidate.slack_message_ts,
      slack_thread_ts: candidate.slack_thread_ts,
      slack_permalink: candidate.slack_permalink,
    })
    .select('id')
    .single();

  if (inserted.error) {
    console.error('[slack] promoting a candidate failed:', inserted.error.message);
    return NextResponse.json({ ok: false, error: inserted.error.message });
  }

  await db
    .from('tech_ticket_candidates')
    .update({
      promoted_ticket_id: inserted.data.id,
      promoted_at: new Date().toISOString(),
    })
    .eq('id', candidate.id);

  await notifyUsers({
    userIds: [candidate.assigned_to, ...candidate.also_notify],
    kind: 'info',
    title: `New tech ticket: "${candidate.title}"`,
    body: candidate.raiser_name
      ? `Raised by ${candidate.raiser_name} in Slack`
      : 'Raised in Slack',
    href: `/tech-support/${inserted.data.id}`,
  });

  const link = hubUrl(`/tech-support/${inserted.data.id}`);
  const lines = [
    `:white_check_mark: Filed after all — *${candidate.title}*`,
    candidate.assigned_to
      ? 'Tech Support on the Hub.'
      : 'Tech Support on the Hub, unassigned.',
  ];
  if (link) lines.push(`<${link}|Open the ticket>`);

  await postThreadReply(
    channelId,
    candidate.slack_thread_ts ?? messageTs,
    lines.join('\n'),
  );

  return NextResponse.json({
    ok: true,
    ticketId: inserted.data.id,
    promotedFrom: candidate.id,
  });
}

/** The Hub login belonging to a Slack email, if there is one. */
async function resolveRaiser(email: string | null): Promise<string | null> {
  if (!email) return null;

  const found = await serviceClient()
    .from('user_profiles')
    .select('id')
    .ilike('email', email)
    .maybeSingle();

  return found.error ? null : (found.data?.id ?? null);
}

export async function POST(request: NextRequest) {
  // Text, not json(). The signature covers the exact bytes Slack sent, and
  // re-serialising a parsed object produces different ones.
  const raw = await request.text();

  let secret: string;
  try {
    secret = slackSigningSecret();
  } catch (error) {
    // 503 rather than 401: "nobody has set this up" and "your signature is
    // wrong" send somebody to entirely different places.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'not configured' },
      { status: 503 },
    );
  }

  const verified = verifySlackSignature({
    body: raw,
    timestamp: request.headers.get('x-slack-request-timestamp'),
    signature: request.headers.get('x-slack-signature'),
    secret,
    nowSeconds: Math.floor(Date.now() / 1000),
  });

  if (!verified.ok) {
    // The reason is logged and not returned. A caller who is not Slack learns
    // nothing from 401, and a caller who is Slack has the reason in the log.
    console.error(`[slack] rejected an event: ${verified.reason}`);
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Body is not JSON.' }, { status: 422 });
  }

  /*
   * The one-time handshake when the Request URL is saved in the Slack app.
   * Signed like any other event, so it is verified above rather than answered
   * before the signature check — which would leave an unauthenticated echo
   * endpoint on a public URL.
   */
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge ?? null });
  }

  if (body.type !== 'event_callback') {
    // Acknowledged, not errored. Slack disables an endpoint that keeps failing,
    // and an event type we do not handle is not a failure.
    return NextResponse.json({ ok: true, ignored: body.type ?? 'unknown' });
  }

  const event = (body.event ?? {}) as AppMentionEvent;

  /*
   * Somebody overruling a decline. See promoteCandidate.
   *
   * Checked before the app_mention gate because it is the other half of the
   * classifier: without it, "react :ticket: if I have that wrong" is a promise
   * the bot cannot keep.
   */
  if (event.type === 'reaction_added') {
    return promoteCandidate(event as unknown as ReactionAddedEvent);
  }

  if (event.type !== 'app_mention') {
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  /*
   * A bot tagging the bot. Rare, but the loop it makes is not: the reply is
   * posted by this app, and any workflow that reacts to it by mentioning @apex
   * again would file tickets until somebody noticed the bill.
   */
  if (event.bot_id || event.subtype === 'bot_message') {
    return NextResponse.json({ ok: true, ignored: 'bot message' });
  }

  const channelId = event.channel;
  const messageTs = event.ts;

  if (!channelId || !messageTs) {
    return NextResponse.json(
      { error: 'app_mention without a channel or ts.' },
      { status: 422 },
    );
  }

  // A mention inside a thread belongs in that thread; a top-level mention
  // starts one. Either way the bot never replies into the channel.
  const threadTs = event.thread_ts ?? messageTs;

  const botUserId =
    typeof body.authorizations === 'object' && Array.isArray(body.authorizations)
      ? ((body.authorizations[0] as { user_id?: string } | undefined)?.user_id ??
        null)
      : null;

  /*
   * Parsed twice, deliberately.
   *
   * The first pass is only to learn which Slack ids the message tags, because
   * that decides who to look up. The second pass is the one that produces the
   * ticket text, and by then the names are known — so the body reads "@Ally"
   * rather than "@U0BRYTXLWM8", which is markup nobody outside Slack can read.
   *
   * parseMention is pure and operates on one short string, so running it twice
   * costs nothing worth measuring and saves threading half-resolved state
   * through the lookups.
   */
  const firstPass = parseMention(event.text ?? '', { botUserId });

  if (firstPass.title === null) {
    await postThreadReply(
      channelId,
      threadTs,
      "I can file that as a tech support ticket — tell me what's wrong in the " +
        'same message and I will. Tag somebody to assign it to them, and add ' +
        '#urgent, #high or #low to set the priority.',
    );
    return NextResponse.json({ ok: false, reason: 'no description given' });
  }

  const raiser = event.user ? await lookupUser(event.user) : null;

  /*
   * Capped at three. Each is a users.info round trip inside a three-second
   * budget, and a message tagging four people is not making a finer-grained
   * assignment than one tagging three — it is tagging a crowd. The cap applies
   * to lookups, not to the ticket: everything typed is still in the body.
   */
  const taggedSlackIds = firstPass.mentionedUserIds.slice(0, 3);

  const [tagged, defaultAssignee, raisedBy, channelName, permalink] =
    await Promise.all([
      Promise.all(
        taggedSlackIds.map(async (slackId) => {
          const user = await lookupUser(slackId);
          return {
            slackId,
            name: user?.name ?? null,
            hubUserId: await resolveRaiser(user?.email ?? null),
          };
        }),
      ),
      resolveAssignee(),
      resolveRaiser(raiser?.email ?? null),
      lookupChannelName(channelId),
      messagePermalink(channelId, messageTs),
    ]);

  const names = Object.fromEntries(
    tagged
      .filter((person) => person.name !== null)
      .map((person) => [person.slackId, person.name as string]),
  );

  const draft = parseMention(event.text ?? '', { botUserId, names });

  /*
   * Tagged wins over the default. See lib/slack/assignee for why only a real
   * Slack mention counts and a name typed as words does not.
   */
  const assignment = chooseAssignee(tagged, {
    id: defaultAssignee.id,
    name: defaultAssignee.name ?? defaultAssignee.email,
  });

  const db = serviceClient();

  /*
   * Is this actually a request?
   *
   * Runs last, after the lookups, because it reads better with the channel and
   * the sender than without them — and because everything above is needed
   * whichever way the verdict goes.
   *
   * Fails open on every path: no key, timeout, malformed answer, all file the
   * ticket. See lib/slack/classify for why the two failure modes are not
   * symmetric.
   */
  const verdict = await looksLikeARequest({
    text: draft.body ?? draft.title ?? '',
    raiserName: raiser?.name ?? null,
    channelName,
  });

  if (!verdict.file) {
    /*
     * Recorded before the reply, so that reacting :ticket: works even if the
     * reply itself fails to post. The row is the recovery path; the message is
     * only how somebody learns the row exists.
     *
     * Conflicts are ignored: a Slack retry of the same event finds the
     * candidate already there and must not post a second decline.
     */
    const candidate = await db
      .from('tech_ticket_candidates')
      .insert({
        title: draft.title ?? firstPass.title,
        body: draft.body,
        priority: draft.priority,
        assigned_to: assignment.assigneeId,
        also_notify: assignment.alsoNotify,
        raiser_slack_id: event.user ?? null,
        raiser_name: raiser?.name ?? event.user ?? null,
        raised_by: raisedBy,
        declined_reason: verdict.reason,
        slack_team_id: (body.team_id as string | undefined) ?? null,
        slack_channel_id: channelId,
        slack_channel_name: channelName,
        slack_message_ts: messageTs,
        slack_thread_ts: threadTs,
        slack_permalink: permalink,
      })
      .select('id')
      .single();

    if (candidate.error) {
      if (candidate.error.code === UNIQUE_VIOLATION) {
        return NextResponse.json({ ok: true, filed: false, duplicate: true });
      }

      /*
       * The record failed, so the recovery path does not exist. Filing the
       * ticket is the safe way to be wrong here — better a ticket nobody
       * wanted than a request with nothing anywhere holding it.
       */
      console.error(
        '[slack] could not record a declined mention, filing it instead:',
        candidate.error.message,
      );
    } else {
      await postThreadReply(
        channelId,
        threadTs,
        `:speech_balloon: I read that as ${verdict.reason} rather than a ` +
          'request, so I have not filed a ticket. React :ticket: on your ' +
          'message if I have that wrong and I will file it.',
      );

      return NextResponse.json({
        ok: true,
        filed: false,
        candidateId: candidate.data.id,
        reason: verdict.reason,
      });
    }
  }

  const inserted = await db
    .from('tech_tickets')
    .insert({
      // The second pass cannot turn a title null when the first pass found
      // one — same text, same bot id, only the display names differ — but the
      // type does not know that, and firstPass.title is already narrowed.
      title: draft.title ?? firstPass.title,
      body: draft.body,
      priority: draft.priority,
      assigned_to: assignment.assigneeId,
      raised_by: raisedBy,
      raised_by_name: raiser?.name ?? event.user ?? null,
      source: 'slack',
      slack_team_id: (body.team_id as string | undefined) ?? null,
      slack_channel_id: channelId,
      slack_channel_name: channelName,
      slack_message_ts: messageTs,
      slack_thread_ts: threadTs,
      slack_permalink: permalink,
    })
    .select('id')
    .single();

  if (inserted.error) {
    /*
     * A retry of an event already filed. Answered 200 with the original
     * ticket's id and, deliberately, no second reply in the thread — the first
     * attempt already posted one, and a duplicate confirmation is how somebody
     * concludes two tickets were opened.
     */
    if (inserted.error.code === UNIQUE_VIOLATION) {
      const existing = await db
        .from('tech_tickets')
        .select('id')
        .eq('slack_channel_id', channelId)
        .eq('slack_message_ts', messageTs)
        .maybeSingle();

      return NextResponse.json({
        ok: true,
        ticketId: existing.data?.id ?? null,
        duplicate: true,
      });
    }

    console.error('[slack] ticket insert failed:', inserted.error.message);

    /*
     * 200, not 500. Slack disables an endpoint that returns errors repeatedly,
     * and the person who tagged @apex needs to know their request did not land
     * far more than Slack needs a status code — so the failure is told to them
     * in the thread instead.
     */
    await postThreadReply(
      channelId,
      threadTs,
      ':warning: I could not file that ticket — the Hub rejected it. Nothing ' +
        'has been recorded, so please try again or tell the tech team directly.',
    );

    return NextResponse.json({ ok: false, error: inserted.error.message });
  }

  /*
   * Tell the assignee in the Hub as well as in the thread.
   *
   * The Slack reply goes to the channel the request came from, which is where
   * the person who asked is looking. It is not where Ally is looking — she may
   * not be in that channel at all, and the whole point of filing the ticket was
   * to get it out of a channel. So the bell gets its own row.
   */
  const title = draft.title ?? firstPass.title;

  /*
   * Everybody tagged is told, not only the one who owns it. Being tagged and
   * hearing nothing is indistinguishable from not having been tagged, and
   * "@Jemie @Ally one of you" means both should know it exists.
   */
  await notifyUsers({
    userIds: [assignment.assigneeId, ...assignment.alsoNotify],
    kind: 'info',
    title: `New tech ticket: "${title}"`,
    body: raiser?.name ? `Raised by ${raiser.name} in Slack` : 'Raised in Slack',
    href: `/tech-support/${inserted.data.id}`,
  });

  const link = hubUrl(`/tech-support/${inserted.data.id}`);

  const lines = [`:white_check_mark: Filed as *${title}*`];

  if (assignment.reason === 'tagged') {
    lines.push(`Tech Support on the Hub, assigned to *${assignment.name}*.`);
  } else if (assignment.reason === 'default') {
    lines.push(`Tech Support on the Hub, assigned to ${assignment.name}.`);
  } else {
    lines.push(
      `Tech Support on the Hub — but *nobody is assigned*: no Hub user has ` +
        `the address ${defaultAssignee.email}. Somebody will need to pick it ` +
        `up by hand.`,
    );
  }

  /*
   * Said out loud rather than swallowed. Somebody who tags a colleague and is
   * not told the tag did nothing will assume the ticket is theirs, and find out
   * days later that it sat with the default assignee instead.
   */
  if (assignment.unknown.length > 0) {
    lines.push(
      `:warning: ${assignment.unknown.join(', ')} ${
        assignment.unknown.length === 1 ? 'has' : 'have'
      } no Hub login, so ${
        assignment.unknown.length === 1 ? 'they' : 'they'
      } could not be assigned or notified.`,
    );
  }

  if (draft.priority !== 'normal') {
    lines.push(`Priority: *${draft.priority}*.`);
  }

  if (link) lines.push(`<${link}|Open the ticket>`);

  await Promise.all([
    postThreadReply(channelId, threadTs, lines.join('\n')),
    addReaction(channelId, messageTs, 'ticket'),
  ]);

  return NextResponse.json({
    ok: true,
    ticketId: inserted.data.id,
    assignedTo: assignment.assigneeId,
    assignedBecause: assignment.reason,
    priority: draft.priority,
  });
}
