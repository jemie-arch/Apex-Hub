/**
 * Exercise the auto-acknowledgement's decision rules.
 *
 * This is the only feature in the Hub that speaks in Slack without a person
 * pressing anything, so the rules that keep it quiet matter more than the one
 * that makes it talk. Every check below is a way it could otherwise embarrass
 * somebody: replying to itself, replying twice, replying at 3am, replying to
 * "Joshua joined the channel", or replying after a person already had.
 *
 *   npm run check:autoreply
 *
 * No database, no network, no Slack.
 */
import {
  AUTOREPLY_DEFAULTS,
  hourIn,
  isDue,
  isQuietHour,
  parseAutoReplyConfig,
  shouldWatch,
  type AutoReplyConfig,
} from '../src/config/slack-autoreply';

let failures = 0;
let checks = 0;

function check(what: string, actual: unknown, expected: unknown) {
  checks += 1;
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ok    ${what}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${what}`);
  console.log(`        expected ${JSON.stringify(expected)}`);
  console.log(`        actual   ${JSON.stringify(actual)}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

const BOT = 'U0BOT';
const JOSHUA = 'U0JOSH';
const OTHER = 'U0OTHER';

function config(over: Partial<AutoReplyConfig> = {}): AutoReplyConfig {
  return { ...AUTOREPLY_DEFAULTS, enabled: true, channelIds: ['C1'], ...over };
}

function message(over: Partial<Parameters<typeof shouldWatch>[0]> = {}) {
  return {
    channelId: 'C1',
    authorSlackId: JOSHUA,
    isBot: false,
    subtype: null,
    threadTs: '100.1',
    messageTs: '100.1',
    ...over,
  };
}

// ---------------------------------------------------------------------------
section('Off unless somebody turned it on');
{
  // The default must be silent. A feature that speaks as Apex should not
  // acquire that ability by being deployed.
  check('the shipped default is disabled', AUTOREPLY_DEFAULTS.enabled, false);
  check('and watches no channels', AUTOREPLY_DEFAULTS.channelIds, []);
  check('an empty config is disabled', parseAutoReplyConfig({}).enabled, false);
  check('a missing config is disabled', parseAutoReplyConfig(undefined).enabled, false);
  check('null is disabled', parseAutoReplyConfig(null).enabled, false);

  /*
   * The classic way a flag turns itself on: JSON holding the string "false",
   * which is truthy. Only exactly true counts.
   */
  check('the string "false" is not on', parseAutoReplyConfig({ enabled: 'false' }).enabled, false);
  check('the string "true" is not on either', parseAutoReplyConfig({ enabled: 'true' }).enabled, false);
  check('1 is not on', parseAutoReplyConfig({ enabled: 1 }).enabled, false);
  check('true is on', parseAutoReplyConfig({ enabled: true }).enabled, true);

  check(
    'a disabled config watches nothing even in a listed channel',
    shouldWatch(message(), config({ enabled: false }), BOT).watch,
    false,
  );
}

section('Config survives being half-written');
{
  // Per field, so adding a channel by hand does not reset the quiet hours.
  const partial = parseAutoReplyConfig({ enabled: true, channel_ids: ['C9'] });
  check('the channel is taken', partial.channelIds, ['C9']);
  check('the delay falls back', partial.delayMinutes, 2);
  check('the template falls back', partial.template, AUTOREPLY_DEFAULTS.template);
  check('quiet hours fall back', [partial.quietHoursStart, partial.quietHoursEnd], [22, 7]);

  // A zero delay would post before the notification reached anybody, which
  // defeats the only reason the delay exists.
  check('a zero delay is floored to one minute', parseAutoReplyConfig({ delay_minutes: 0 }).delayMinutes, 1);
  check('a negative delay too', parseAutoReplyConfig({ delay_minutes: -5 }).delayMinutes, 1);
  check('a silly delay is capped at a day', parseAutoReplyConfig({ delay_minutes: 99999 }).delayMinutes, 1440);
  check('a fractional delay is truncated', parseAutoReplyConfig({ delay_minutes: 2.7 }).delayMinutes, 2);
  check('a non-numeric delay falls back', parseAutoReplyConfig({ delay_minutes: 'two' }).delayMinutes, 2);

  check('an empty template falls back', parseAutoReplyConfig({ template: '   ' }).template, AUTOREPLY_DEFAULTS.template);
  check('non-string ids are dropped', parseAutoReplyConfig({ channel_ids: ['C1', 7, null] }).channelIds, ['C1']);
  check('a non-array id list is empty', parseAutoReplyConfig({ channel_ids: 'C1' }).channelIds, []);
  // Zero is a real setting: it means "record but never speak".
  check('a zero rate limit is kept', parseAutoReplyConfig({ max_replies_per_hour: 0 }).maxRepliesPerHour, 0);
}

section('It must never answer itself');
{
  /*
   * The loop. The bot's acknowledgement is itself a message in a watched
   * channel; without these it would see it, wait two minutes, and acknowledge
   * its own acknowledgement for as long as the bill allowed.
   */
  check('a bot_id message is ignored', shouldWatch(message({ isBot: true }), config(), BOT).watch, false);
  check('our own user id is ignored', shouldWatch(message({ authorSlackId: BOT }), config(), BOT).watch, false);
  check('and the reason says so', shouldWatch(message({ authorSlackId: BOT }), config(), BOT).reason, 'our own message');
  check('a message with no author is ignored', shouldWatch(message({ authorSlackId: null }), config(), BOT).watch, false);
}

section('Only real messages, only thread starts');
{
  /*
   * Joins, leaves, pins, topic changes, edits and deletions all arrive as
   * `message` with a subtype. Acknowledging "Joshua joined the channel" is how
   * a bot gets muted.
   */
  check('a channel join is ignored', shouldWatch(message({ subtype: 'channel_join' }), config(), BOT).watch, false);
  check('an edit is ignored', shouldWatch(message({ subtype: 'message_changed' }), config(), BOT).watch, false);
  check('a deletion is ignored', shouldWatch(message({ subtype: 'message_deleted' }), config(), BOT).watch, false);

  /*
   * A reply inside an existing thread is a conversation already happening.
   * Acknowledging each new reply would put the bot in the middle of it.
   */
  check(
    'a thread reply is ignored',
    shouldWatch(message({ threadTs: '100.1', messageTs: '100.9' }), config(), BOT).watch,
    false,
  );
  check(
    'a thread start is watched',
    shouldWatch(message({ threadTs: '100.1', messageTs: '100.1' }), config(), BOT).watch,
    true,
  );
}

section('Only watched channels and watched people');
{
  check('an unwatched channel is ignored', shouldWatch(message({ channelId: 'C-OTHER' }), config(), BOT).watch, false);
  check('a watched channel is watched', shouldWatch(message(), config(), BOT).watch, true);

  // Empty means everybody, which is what makes "core team channel" work
  // without listing every colleague.
  check('an empty author list means everybody', shouldWatch(message({ authorSlackId: OTHER }), config(), BOT).watch, true);

  const narrowed = config({ authorSlackIds: [JOSHUA] });
  check('a listed author is watched', shouldWatch(message({ authorSlackId: JOSHUA }), narrowed, BOT).watch, true);
  check('an unlisted author is not', shouldWatch(message({ authorSlackId: OTHER }), narrowed, BOT).watch, false);
}

section('The delay, which exists to be lost to a human');
{
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 7, 12, minutes, 0));
  const detected = at(0);
  const two = config({ delayMinutes: 2 });

  check('not due immediately', isDue(detected, two, at(0)), false);
  check('not due after one minute', isDue(detected, two, at(1)), false);
  // Inclusive at the boundary: a sweep landing exactly on it should act.
  check('due at exactly two minutes', isDue(detected, two, at(2)), true);
  check('due after three', isDue(detected, two, at(3)), true);
}

section('Quiet hours, including the window that crosses midnight');
{
  /*
   * 22 to 7 is two ranges, not one. Read as `start <= h && h < end` it is
   * always false, which would have the bot replying all night while looking
   * configured not to. This is the check that catches that.
   */
  const overnight = config({ quietHoursStart: 22, quietHoursEnd: 7, timezone: 'UTC' });
  const utc = (hour: number) => new Date(Date.UTC(2026, 8, 7, hour, 30, 0));

  check('23:30 is quiet', isQuietHour(overnight, utc(23)), true);
  check('02:30 is quiet', isQuietHour(overnight, utc(2)), true);
  check('06:30 is quiet', isQuietHour(overnight, utc(6)), true);
  check('07:30 is not', isQuietHour(overnight, utc(7)), false);
  check('12:30 is not', isQuietHour(overnight, utc(12)), false);
  check('21:30 is not', isQuietHour(overnight, utc(21)), false);
  check('22:30 is quiet', isQuietHour(overnight, utc(22)), true);

  // A same-hours window means no quiet period, not a 24-hour one.
  const none = config({ quietHoursStart: 0, quietHoursEnd: 0, timezone: 'UTC' });
  check('start equal to end is never quiet', isQuietHour(none, utc(3)), false);

  // A daytime window is the ordinary reading.
  const daytime = config({ quietHoursStart: 9, quietHoursEnd: 17, timezone: 'UTC' });
  check('a same-day window works too', [isQuietHour(daytime, utc(10)), isQuietHour(daytime, utc(20))], [true, false]);

  // Timezone is honoured, and an unknown one falls back rather than throwing —
  // a bad timezone string must not stop every reply.
  check('the timezone is applied', hourIn('Asia/Manila', new Date(Date.UTC(2026, 8, 7, 0, 0, 0))), 8);
  check('an unknown timezone falls back to UTC', hourIn('Not/AZone', new Date(Date.UTC(2026, 8, 7, 5, 0, 0))), 5);
}

section('The template says what it is');
{
  /*
   * A reply that reads as human when it is not is worse than no reply. The
   * shipped wording has to disclose itself, and it must not promise an answer
   * it cannot give.
   */
  const template = AUTOREPLY_DEFAULTS.template.toLowerCase();
  check('it admits to being automatic', template.includes('automatic'), true);
  check('and says it is not an answer', template.includes('not an answer'), true);
}

// ---------------------------------------------------------------------------
console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : ''),
);
process.exit(failures ? 1 : 0);
