/**
 * Auto-acknowledgement of unanswered Slack messages.
 *
 * WHAT THIS IS FOR
 *
 * So that nothing from Joshua or the core team sits unanswered while nobody
 * has noticed it. The guarantee asked for was that the communication happens —
 * not that the answer is right, which no automation can promise.
 *
 * SO IT ACKNOWLEDGES, IT DOES NOT ANSWER.
 *
 * That distinction is the whole design. An acknowledgement is true whatever
 * the message said: it has been seen, somebody has been told, an answer is
 * coming. A generated answer is a guess posted under Apex's name to the CEO,
 * unread by anyone, and the first wrong one is the one that costs something.
 * The template says outright that it is automatic, because a reply that reads
 * as human when it is not is worse than no reply.
 *
 * WHAT IT CANNOT DO, AND WHY THAT IS NOT AN OMISSION
 *
 * It cannot touch a DM between two people. A Slack bot token sees only the
 * channels the bot is in and DMs with the bot itself; there is no scope that
 * lets a bot read one person's DMs with another. Doing that needs a user
 * token, which env.ts rejects on purpose — a user token carries the full reach
 * of whoever installed it, every private channel and DM they can see, and
 * would post as them.
 *
 * So: watched CHANNELS work, and the bot replies as @apex. Joshua's DMs to
 * Jemie are out of reach, and the honest workaround is a channel rather than a
 * credential that turns the Hub into Jemie's Slack account.
 */

/** The app_settings row this reads. Changing config needs no deploy. */
export const AUTOREPLY_SETTING_KEY = 'slack_autoreply';

export interface AutoReplyConfig {
  enabled: boolean;
  /** How long a human gets to answer first. */
  delayMinutes: number;
  /** Channels to watch. Empty means watch nothing — off by omission. */
  channelIds: string[];
  /** Narrow to specific authors. Empty means every human in those channels. */
  authorSlackIds: string[];
  maxRepliesPerHour: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  timezone: string;
  template: string;
}

/*
 * Defaults chosen so that a half-written config does nothing rather than
 * something surprising: disabled, watching no channels, and refusing to speak
 * outside working hours.
 */
export const AUTOREPLY_DEFAULTS: AutoReplyConfig = {
  enabled: false,
  delayMinutes: 2,
  channelIds: [],
  authorSlackIds: [],
  maxRepliesPerHour: 6,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  timezone: 'Asia/Manila',
  template:
    'Seen this — Jemie has been notified and will come back to you shortly. ' +
    'This is an automatic acknowledgement, not an answer.',
};

/**
 * Read the stored config, falling back per field.
 *
 * Per field rather than all-or-nothing: somebody adding a channel id by hand
 * should not have to restate the quiet hours, and a typo in one key should not
 * silently reset the rest.
 *
 * delayMinutes is floored at 1. Zero would post before the notification had
 * reached anybody, which defeats the delay — its purpose is to lose the race
 * to a human.
 */
export function parseAutoReplyConfig(value: unknown): AutoReplyConfig {
  const raw = (value ?? {}) as Record<string, unknown>;

  const num = (key: string, fallback: number, min: number, max: number): number => {
    const candidate = raw[key];
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return fallback;
    return Math.min(Math.max(Math.trunc(candidate), min), max);
  };

  const ids = (key: string): string[] => {
    const candidate = raw[key];
    if (!Array.isArray(candidate)) return [];
    return candidate.filter((entry): entry is string => typeof entry === 'string');
  };

  const template =
    typeof raw['template'] === 'string' && raw['template'].trim() !== ''
      ? raw['template']
      : AUTOREPLY_DEFAULTS.template;

  return {
    // Anything other than exactly true is off. A string "false" read as truthy
    // is the classic way a feature flag turns itself on.
    enabled: raw['enabled'] === true,
    delayMinutes: num('delay_minutes', AUTOREPLY_DEFAULTS.delayMinutes, 1, 24 * 60),
    channelIds: ids('channel_ids'),
    authorSlackIds: ids('author_slack_ids'),
    maxRepliesPerHour: num('max_replies_per_hour', AUTOREPLY_DEFAULTS.maxRepliesPerHour, 0, 60),
    quietHoursStart: num('quiet_hours_start', AUTOREPLY_DEFAULTS.quietHoursStart, 0, 23),
    quietHoursEnd: num('quiet_hours_end', AUTOREPLY_DEFAULTS.quietHoursEnd, 0, 23),
    timezone:
      typeof raw['timezone'] === 'string' && raw['timezone'].trim() !== ''
        ? raw['timezone']
        : AUTOREPLY_DEFAULTS.timezone,
    template,
  };
}

/**
 * Is this message one to watch at all?
 *
 * Kept separate from the sweeper so the rule can be read in one place and
 * tested without a Slack payload. Every arm of it is a way the bot could
 * otherwise end up talking to itself.
 */
export function shouldWatch(
  message: {
    channelId: string;
    authorSlackId: string | null;
    isBot: boolean;
    subtype: string | null;
    threadTs: string;
    messageTs: string;
  },
  config: AutoReplyConfig,
  botUserId: string | null,
): { watch: boolean; reason: string } {
  if (!config.enabled) return { watch: false, reason: 'disabled' };

  if (!config.channelIds.includes(message.channelId)) {
    return { watch: false, reason: 'channel not watched' };
  }

  /*
   * The loop guard, and the reason it comes before anything cleverer: the bot's
   * own acknowledgement is a message in a watched channel. Without this it
   * would see it, wait two minutes, and acknowledge its own acknowledgement,
   * for as long as the bill allowed.
   */
  if (message.isBot) return { watch: false, reason: 'bot message' };
  if (botUserId && message.authorSlackId === botUserId) {
    return { watch: false, reason: 'our own message' };
  }
  if (message.authorSlackId === null) {
    return { watch: false, reason: 'no author' };
  }

  /*
   * Joins, leaves, pins, channel topics, edits and deletions all arrive as
   * `message` with a subtype. None of them is somebody asking for something,
   * and acknowledging "Joshua joined the channel" is the kind of thing that
   * gets a bot muted.
   */
  if (message.subtype !== null) {
    return { watch: false, reason: `subtype ${message.subtype}` };
  }

  /*
   * Only the start of a thread. A reply inside an existing thread is already a
   * conversation somebody is having, and acknowledging each new reply would put
   * the bot in the middle of it.
   */
  if (message.threadTs !== message.messageTs) {
    return { watch: false, reason: 'thread reply' };
  }

  if (
    config.authorSlackIds.length > 0 &&
    !config.authorSlackIds.includes(message.authorSlackId)
  ) {
    return { watch: false, reason: 'author not watched' };
  }

  return { watch: true, reason: 'watched' };
}

/**
 * The hour, in the configured timezone, as a number.
 *
 * Via Intl rather than arithmetic on the offset, so daylight saving is the
 * platform's problem rather than a bug that appears twice a year.
 */
export function hourIn(timezone: string, at: Date): number {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(at);
    const hour = Number(formatted);
    return Number.isFinite(hour) ? hour % 24 : at.getUTCHours();
  } catch {
    // An unknown timezone must not stop the sweeper; UTC and a wrong quiet
    // window is better than an exception that stops every reply.
    return at.getUTCHours();
  }
}

/**
 * Quiet hours, including the ordinary case of a window crossing midnight.
 *
 * 22 to 7 is two ranges, not one, and treating it as `start <= h && h < end`
 * makes it always false — which would have the bot replying all night while
 * looking configured not to.
 */
export function isQuietHour(config: AutoReplyConfig, at: Date): boolean {
  const hour = hourIn(config.timezone, at);
  const { quietHoursStart: start, quietHoursEnd: end } = config;

  if (start === end) return false; // no quiet window
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/**
 * Is this message due a reply yet?
 *
 * `now` is passed in rather than read, so the delay can be tested without
 * waiting two minutes.
 */
export function isDue(
  detectedAt: Date,
  config: AutoReplyConfig,
  now: Date,
): boolean {
  const elapsedMs = now.getTime() - detectedAt.getTime();
  return elapsedMs >= config.delayMinutes * 60_000;
}
