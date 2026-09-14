/**
 * The Slack Web API calls the ticket bot makes.
 *
 * A bot token here, unlike lib/notify/slack.ts which deliberately uses an
 * incoming webhook. The difference is what each one has to do. An alert only
 * ever posts one message to one channel, so a webhook — which can do nothing
 * else even if it leaks — is exactly right. A bot has to read who tagged it,
 * reply in the thread it was tagged in, and react to the message, none of which
 * a webhook can do at all.
 *
 * SLACK RETURNS 200 WHEN IT FAILS. Every method answers `{ok: false, error}`
 * over HTTP 200, so checking `response.ok` alone reports success for a call
 * that was rejected for a missing scope. That is the single easiest way to
 * ship a bot that silently does nothing, so the body is what is checked here.
 *
 * Everything is best-effort in the same sense the sync alerts are: the ticket
 * row is the durable record, and a Slack outage must not stop one being filed.
 * The functions return null rather than throwing, and the route decides what a
 * null means for the reply it sends.
 */
import { slackBotToken, slackUserToken } from '@/lib/env';

const API_BASE = 'https://slack.com/api';

interface SlackResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Which credential a call uses.
 *
 * 'bot' is everything. 'user' exists solely because Slack shows a DM only to
 * its two participants — see SLACK_USER_TOKEN in lib/env for what that token
 * carries and why it is kept to this one job.
 */
export type Speaker = 'bot' | 'user';

/**
 * A DM channel, by id.
 *
 * Slack ids carry their type in the first character: C is a public channel, G
 * a private one, D a direct message. Deciding by id rather than by
 * configuration is deliberate — it means the user token cannot be pointed at a
 * regular channel by editing a settings row. Widening it takes a code change
 * and a review.
 */
export function isDirectMessage(channelId: string): boolean {
  return channelId.startsWith('D');
}

/** The credential a channel requires. DMs need the user token; nothing else does. */
export function speakerFor(channelId: string): Speaker {
  return isDirectMessage(channelId) ? 'user' : 'bot';
}

/**
 * One POST to a Web API method, or null.
 *
 * The method name is logged with the Slack error code on failure, because
 * `missing_scope` on `users.info` and `missing_scope` on `chat.postMessage`
 * need two different scopes added and the code alone does not say which.
 */
async function call(
  method: string,
  body: Record<string, unknown>,
  speaker: Speaker = 'bot',
): Promise<SlackResponse | null> {
  let token: string;
  try {
    token = speaker === 'user' ? slackUserToken() : slackBotToken();
  } catch (error) {
    // Logged with the speaker, because "not configured" means two entirely
    // different fixes depending on which token was wanted.
    console.error(
      `[slack] ${method} skipped (${speaker} token):`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }

  try {
    const response = await fetch(`${API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as SlackResponse;

    if (!payload.ok) {
      console.error(`[slack] ${method} rejected: ${payload.error ?? 'unknown'}`);
      return null;
    }

    return payload;
  } catch (error) {
    console.error(
      `[slack] ${method} could not be called:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export interface SlackUser {
  id: string;
  /** Real name, display name, or the id — in that order of preference. */
  name: string;
  /** Null unless the app holds users:read.email and the account has one. */
  email: string | null;
  isBot: boolean;
}

/**
 * Who a Slack user id belongs to.
 *
 * The email is what matches them to a Hub login, and it is the reason
 * users:read.email is worth requesting: without it every ticket is raised by
 * somebody the Hub cannot recognise, and raised_by stays null forever.
 */
export async function lookupUser(userId: string): Promise<SlackUser | null> {
  const payload = await call('users.info', { user: userId });
  if (!payload) return null;

  const user = payload.user as
    | {
        id?: string;
        name?: string;
        real_name?: string;
        is_bot?: boolean;
        profile?: { email?: string; real_name?: string; display_name?: string };
      }
    | undefined;

  if (!user?.id) return null;

  const profile = user.profile ?? {};
  const name =
    profile.real_name?.trim() ||
    profile.display_name?.trim() ||
    user.real_name?.trim() ||
    user.name?.trim() ||
    user.id;

  return {
    id: user.id,
    name,
    email: profile.email?.trim() || null,
    isBot: user.is_bot === true,
  };
}

/** The channel's name, for reading a ticket without opening Slack. */
export async function lookupChannelName(
  channelId: string,
): Promise<string | null> {
  const payload = await call('conversations.info', { channel: channelId });
  if (!payload) return null;

  const channel = payload.channel as { name?: string } | undefined;
  return channel?.name?.trim() || null;
}

/**
 * A permanent link back to the message that raised the ticket.
 *
 * Worth a whole extra API call. The ticket carries the text somebody typed, and
 * the thread carries the screenshots, the follow-up, and the three people who
 * said "same here" — which is most of what makes a support request actionable.
 */
export async function messagePermalink(
  channelId: string,
  messageTs: string,
): Promise<string | null> {
  const payload = await call('chat.getPermalink', {
    channel: channelId,
    message_ts: messageTs,
  });
  if (!payload) return null;

  const link = payload.permalink;
  return typeof link === 'string' ? link : null;
}

/**
 * Has a person already replied in this thread?
 *
 * The last guard before the auto-acknowledgement speaks, and the one that
 * makes the delay mean something: two minutes exists so a human can win the
 * race, and this is how the bot notices that they did.
 *
 * Bot replies do not count, including its own — otherwise a single
 * acknowledgement would make every later message in that thread look answered.
 * The thread root is not a reply, so it is excluded by ts rather than by
 * position.
 *
 * Returns null when Slack could not be asked. The caller must treat that as
 * "do not reply": an unknown thread state is the one case where staying quiet
 * costs nothing and speaking might duplicate a person.
 */
export async function humanRepliedInThread(
  channelId: string,
  threadTs: string,
  speaker: Speaker = speakerFor(channelId),
): Promise<boolean | null> {
  const payload = await call(
    'conversations.replies',
    { channel: channelId, ts: threadTs, limit: 50 },
    speaker,
  );
  if (!payload) return null;

  const messages = payload.messages as
    | { ts?: string; user?: string; bot_id?: string; subtype?: string }[]
    | undefined;
  if (!Array.isArray(messages)) return null;

  return messages.some(
    (message) =>
      message.ts !== threadTs &&
      !message.bot_id &&
      message.subtype === undefined &&
      typeof message.user === 'string',
  );
}

/**
 * Has anybody answered this DM yet?
 *
 * A SEPARATE QUESTION FROM humanRepliedInThread, AND IT HAS TO BE.
 *
 * In a channel, an answer is a reply in the thread. In a direct message it
 * almost never is — people just send the next message. Asking
 * conversations.replies about a DM would nearly always come back empty, the
 * sweeper would conclude nobody had answered, and it would acknowledge a
 * message that had already been dealt with minutes ago. That is the single
 * most likely way this feature could embarrass somebody.
 *
 * So a DM is answered when anyone other than the person who wrote it has
 * spoken since — thread reply or not. `oldest` is exclusive of nothing, so the
 * original message comes back too and is filtered out by ts.
 *
 * Same null contract as its sibling: could-not-ask means do not speak.
 */
export async function humanRepliedAfterInDm(
  channelId: string,
  messageTs: string,
  authorSlackId: string | null,
): Promise<boolean | null> {
  const payload = await call(
    'conversations.history',
    { channel: channelId, oldest: messageTs, limit: 50, inclusive: true },
    'user',
  );
  if (!payload) return null;

  const messages = payload.messages as
    | { ts?: string; user?: string; bot_id?: string; subtype?: string }[]
    | undefined;
  if (!Array.isArray(messages)) return null;

  return messages.some(
    (message) =>
      message.ts !== messageTs &&
      !message.bot_id &&
      message.subtype === undefined &&
      typeof message.user === 'string' &&
      // Joshua sending three messages in a row has not answered himself.
      message.user !== authorSlackId,
  );
}

/**
 * Posts into a conversation without threading.
 *
 * For DMs. A threaded reply in a direct message is a shape almost nobody uses,
 * and it hides the acknowledgement behind a "1 reply" line that the recipient
 * has to click — which defeats the point of answering within two minutes.
 */
export async function postMessage(
  channelId: string,
  text: string,
  speaker: Speaker = speakerFor(channelId),
): Promise<boolean> {
  const payload = await call(
    'chat.postMessage',
    { channel: channelId, text, unfurl_links: false, unfurl_media: false },
    speaker,
  );
  return payload !== null;
}

/**
 * Replies in the thread of the message that tagged the bot.
 *
 * `thread_ts` is always the mention's own ts when the mention was a top-level
 * message, which is what starts a thread rather than replying into the channel.
 * A bot that answers in-channel turns every request into two messages everybody
 * has to scroll past.
 */
export async function postThreadReply(
  channelId: string,
  threadTs: string,
  text: string,
  speaker: Speaker = speakerFor(channelId),
): Promise<boolean> {
  const payload = await call('chat.postMessage', {
    channel: channelId,
    thread_ts: threadTs,
    text,
    // Off, so a ticket confirmation never re-pings the channel. The person who
    // tagged the bot is already in the thread.
    unfurl_links: false,
    unfurl_media: false,
  }, speaker);
  return payload !== null;
}

/**
 * Marks the original message as filed.
 *
 * Fails harmlessly when somebody has already added the same reaction by hand —
 * Slack answers `already_reacted`, which is logged and otherwise ignored.
 */
export async function addReaction(
  channelId: string,
  messageTs: string,
  name: string,
): Promise<boolean> {
  const payload = await call('reactions.add', {
    channel: channelId,
    timestamp: messageTs,
    name,
  });
  return payload !== null;
}

/**
 * The bot's own user id, so a message can be re-parsed the way it was parsed
 * when it arrived.
 *
 * At ingest the id comes free on the event's `authorizations`. Reading an old
 * message back has no event, and without the id parseMention leaves the bot's
 * own tag in the text — so every backfilled title would begin "@U0BOT…".
 *
 * One call for a whole backfill, so it is fetched rather than configured.
 */
export async function botUserId(speaker: Speaker = 'bot'): Promise<string | null> {
  const payload = await call('auth.test', {}, speaker);
  const id = payload?.['user_id'];
  return typeof id === 'string' ? id : null;
}

/**
 * The original text of one message.
 *
 * conversations.replies with the message's own ts returns that message first,
 * whether or not it ever grew a thread — so this works for a ticket raised by a
 * top-level mention as well as one raised inside a thread.
 *
 * Returns null when Slack could not be asked or the message is gone. A caller
 * repairing old rows must leave them alone in that case rather than writing an
 * empty body over a truncated title, which would lose the little that survived.
 */
export async function fetchMessageText(
  channelId: string,
  messageTs: string,
  speaker: Speaker = speakerFor(channelId),
): Promise<string | null> {
  const payload = await call(
    'conversations.replies',
    { channel: channelId, ts: messageTs, limit: 1 },
    speaker,
  );
  if (!payload) return null;

  const messages = payload.messages as { ts?: string; text?: string }[] | undefined;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const root = messages.find((message) => message.ts === messageTs) ?? messages[0];
  const text = root?.text;

  return typeof text === 'string' && text.trim() !== '' ? text : null;
}
