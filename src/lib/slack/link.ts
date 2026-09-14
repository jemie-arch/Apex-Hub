/**
 * A link back to the Slack message a ticket came from.
 *
 * Every ticket raised through Slack already knows its team, channel and message
 * timestamp. None of them has a `slack_permalink` — the column exists and is
 * null on all 22 — so rather than backfill it with a `chat.getPermalink` call
 * per ticket, the link is built from what is already stored. That also means it
 * works for tickets filed before this existed, which a backfill would not
 * without a migration and an API round trip each.
 *
 * `slack.com/app_redirect` rather than a `<team>.slack.com/archives/...` URL.
 * The archives form needs the workspace's subdomain, which we do not store —
 * only the team id. app_redirect takes the team id, and Slack does the rest:
 * it opens the desktop app when it is installed and falls back to the browser
 * when it is not, which is the behaviour anyone clicking from the Hub wants.
 *
 * Returns null rather than a broken link when any part is missing. A dead link
 * to Slack is worse than no link: it reads as "this ticket has no thread"
 * only after the click has already failed.
 */
export function slackMessageUrl(input: {
  teamId: string | null;
  channelId: string | null;
  /** The thread's own timestamp, so the link lands on the conversation. */
  threadTs: string | null;
  /** Falls back to the message timestamp for tickets with no thread recorded. */
  messageTs?: string | null;
}): string | null {
  const ts = input.threadTs ?? input.messageTs ?? null;

  if (!input.teamId || !input.channelId || !ts) return null;

  const params = new URLSearchParams({
    team: input.teamId,
    channel: input.channelId,
    message_ts: ts,
  });

  return `https://slack.com/app_redirect?${params.toString()}`;
}
