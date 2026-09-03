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
import { slackBotToken } from '@/lib/env';

const API_BASE = 'https://slack.com/api';

interface SlackResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
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
): Promise<SlackResponse | null> {
  let token: string;
  try {
    token = slackBotToken();
  } catch (error) {
    console.error(
      `[slack] ${method} skipped:`,
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
): Promise<boolean> {
  const payload = await call('chat.postMessage', {
    channel: channelId,
    thread_ts: threadTs,
    text,
    // Off, so a ticket confirmation never re-pings the channel. The person who
    // tagged the bot is already in the thread.
    unfurl_links: false,
    unfurl_media: false,
  });
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
