/**
 * Exercise the two pure halves of the @apex ticket bot.
 *
 * The signature check is the only thing protecting /api/slack/events, which has
 * a public URL by necessity — Slack decides what it sends and cannot be told to
 * add an Authorization header. Code that is the sole guard on a public endpoint
 * deserves assertions rather than trust, and the failure modes here are the
 * quiet kind: a signature computed over a re-serialised body matches nothing,
 * and a missing timestamp check leaves a captured request valid forever.
 *
 * The parser earns its assertions for a different reason. It decides what a
 * ticket says, and every case below is a real shape of Slack message: a mention
 * mid-sentence, a pasted link, a thread of detail under a one-line headline.
 *
 *   npm run check:slack
 *
 * No database, no network, no secret — the signing secret below is invented.
 */
import { chooseAssignee } from '../src/lib/slack/assignee';
import { parseMention, userIdsIn } from '../src/lib/slack/mention';
import {
  MAX_SKEW_SECONDS,
  signSlackRequest,
  verifySlackSignature,
} from '../src/lib/slack/signature';

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

/** Not a real signing secret. Slack's are 32 hex characters. */
const SECRET = '8f14e45fceea167a5a36dedd4bea2543';
const BOT = 'B07APEXBOT';
const NOW = 1_770_000_000;

// ---------------------------------------------------------------------------
section('A genuine Slack request is accepted');
{
  const body = '{"type":"event_callback","event":{"type":"app_mention"}}';
  const ts = String(NOW);
  const signature = signSlackRequest(body, ts, SECRET);

  check(
    'correctly signed and recent',
    verifySlackSignature({
      body,
      timestamp: ts,
      signature,
      secret: SECRET,
      nowSeconds: NOW,
    }),
    { ok: true },
  );

  // Slack's clock and the function host's are never exactly equal, and a
  // request that arrives a minute late is still a real request.
  check(
    'inside the skew window',
    verifySlackSignature({
      body,
      timestamp: String(NOW - MAX_SKEW_SECONDS + 5),
      signature: signSlackRequest(body, String(NOW - MAX_SKEW_SECONDS + 5), SECRET),
      secret: SECRET,
      nowSeconds: NOW,
    }),
    { ok: true },
  );
}

section('Everything else is rejected, with the reason kept');
{
  const body = '{"type":"event_callback"}';
  const ts = String(NOW);
  const good = signSlackRequest(body, ts, SECRET);

  check(
    'no signature header',
    verifySlackSignature({ body, timestamp: ts, signature: null, secret: SECRET, nowSeconds: NOW }),
    { ok: false, reason: 'missing_headers' },
  );

  check(
    'no timestamp header',
    verifySlackSignature({ body, timestamp: null, signature: good, secret: SECRET, nowSeconds: NOW }),
    { ok: false, reason: 'missing_headers' },
  );

  check(
    'timestamp that is not a number',
    verifySlackSignature({ body, timestamp: 'yesterday', signature: good, secret: SECRET, nowSeconds: NOW }),
    { ok: false, reason: 'malformed_timestamp' },
  );

  /*
   * The replay case. A captured request stays byte-identical forever, so
   * without this check anyone who ever saw one could file tickets with it.
   */
  {
    const old = String(NOW - MAX_SKEW_SECONDS - 1);
    check(
      'a request older than the window, correctly signed',
      verifySlackSignature({
        body,
        timestamp: old,
        signature: signSlackRequest(body, old, SECRET),
        secret: SECRET,
        nowSeconds: NOW,
      }),
      { ok: false, reason: 'stale_timestamp' },
    );
  }

  // A clock that has run ahead is as suspicious as one that has run behind.
  {
    const future = String(NOW + MAX_SKEW_SECONDS + 1);
    check(
      'a request from the future',
      verifySlackSignature({
        body,
        timestamp: future,
        signature: signSlackRequest(body, future, SECRET),
        secret: SECRET,
        nowSeconds: NOW,
      }),
      { ok: false, reason: 'stale_timestamp' },
    );
  }

  check(
    'signed with a different secret',
    verifySlackSignature({
      body,
      timestamp: ts,
      signature: signSlackRequest(body, ts, 'a-different-signing-secret-entirely'),
      secret: SECRET,
      nowSeconds: NOW,
    }),
    { ok: false, reason: 'mismatch' },
  );

  /*
   * THE ONE THAT COSTS A DAY. The signature covers the exact bytes Slack sent.
   * Parsing the body and re-serialising it changes key order and whitespace,
   * and every request then fails with a mismatch indistinguishable from a
   * wrong secret. This pins that the difference is detected.
   */
  check(
    're-serialised body, same content',
    verifySlackSignature({
      body: JSON.stringify(JSON.parse('{"type":"event_callback", "b":1}')),
      timestamp: ts,
      signature: signSlackRequest('{"type":"event_callback", "b":1}', ts, SECRET),
      secret: SECRET,
      nowSeconds: NOW,
    }),
    { ok: false, reason: 'mismatch' },
  );

  check(
    'a version prefix that is not v0',
    verifySlackSignature({ body, timestamp: ts, signature: good.replace('v0=', 'v1='), secret: SECRET, nowSeconds: NOW }),
    { ok: false, reason: 'unsupported_version' },
  );

  check(
    'a truncated signature',
    verifySlackSignature({ body, timestamp: ts, signature: good.slice(0, 20), secret: SECRET, nowSeconds: NOW }),
    { ok: false, reason: 'mismatch' },
  );
}

// ---------------------------------------------------------------------------
section('The bot tag is removed wherever it sits');
{
  check(
    'leading',
    parseMention(`<@${BOT}> calendar sync is down`, { botUserId: BOT }).title,
    'calendar sync is down',
  );

  check(
    'mid-sentence',
    parseMention(`hey can <@${BOT}> look at the calendar sync`, { botUserId: BOT }).title,
    'hey can look at the calendar sync',
  );

  check(
    'trailing',
    parseMention(`calendar sync is down <@${BOT}>`, { botUserId: BOT }).title,
    'calendar sync is down',
  );
}

section('Other people keep their names');
{
  check(
    'resolved to a display name when the caller looked it up',
    parseMention(`<@${BOT}> ask <@U123ALLY> about it`, {
      botUserId: BOT,
      names: { U123ALLY: 'Ally' },
    }).title,
    'ask @Ally about it',
  );

  check(
    'falls back to the id rather than leaving raw markup',
    parseMention(`<@${BOT}> ask <@U123ALLY> about it`, { botUserId: BOT }).title,
    'ask @U123ALLY about it',
  );

  check(
    'the bot is not listed as a mentioned user',
    userIdsIn(`<@${BOT}> and <@U123ALLY>`).filter((id) => id !== BOT),
    ['U123ALLY'],
  );
}

section('Slack markup becomes something readable in a browser');
{
  check(
    'a labelled link keeps its URL',
    parseMention(`<@${BOT}> see <https://hub.example/settings|the settings page>`, {
      botUserId: BOT,
    }).title,
    'see the settings page (https://hub.example/settings)',
  );

  check(
    'a bare link is left alone',
    parseMention(`<@${BOT}> see <https://hub.example/settings>`, { botUserId: BOT }).title,
    'see https://hub.example/settings',
  );

  check(
    'a channel reference',
    parseMention(`<@${BOT}> posted in <#C0123|tech-team>`, { botUserId: BOT }).title,
    'posted in #tech-team',
  );

  check(
    'escaped entities are decoded',
    parseMention(`<@${BOT}> spend &gt; 500 &amp; rising`, { botUserId: BOT }).title,
    'spend > 500 & rising',
  );
}

section('Priority comes from a tag, never from tone');
{
  check(
    'an explicit tag is read and removed',
    parseMention(`<@${BOT}> calendar sync is down #urgent`, { botUserId: BOT }),
    { title: 'calendar sync is down', body: null, priority: 'urgent', mentionedUserIds: [] },
  );

  check(
    'a tag anywhere in the message',
    parseMention(`<@${BOT}> #high the sync is down`, { botUserId: BOT }).priority,
    'high',
  );

  /*
   * The whole reason priority is tagged rather than inferred. Every one of
   * these is how somebody normally writes, and reading urgency out of them
   * would produce a field nobody could trust.
   */
  check(
    'the word urgent in a sentence is not a tag',
    parseMention(`<@${BOT}> this is urgent, the sync is down`, { botUserId: BOT }).priority,
    'normal',
  );

  check(
    'nor is asap',
    parseMention(`<@${BOT}> need this asap please`, { botUserId: BOT }).priority,
    'normal',
  );

  check(
    'a later tag overrides an earlier one',
    parseMention(`<@${BOT}> #low actually no #urgent`, { botUserId: BOT }).priority,
    'urgent',
  );

  check(
    'an unknown hashtag is left in the text',
    parseMention(`<@${BOT}> broken again #ghl`, { botUserId: BOT }).title,
    'broken again #ghl',
  );
}

section('Headline and detail');
{
  const multi = parseMention(
    `<@${BOT}> Calendar sync is down\nStarted around 9am.\nThree practices affected.`,
    { botUserId: BOT },
  );

  check('the first line is the title', multi.title, 'Calendar sync is down');
  check(
    'the whole message is the body',
    multi.body,
    'Calendar sync is down\nStarted around 9am.\nThree practices affected.',
  );

  check(
    'a one-line message stores no duplicate body',
    parseMention(`<@${BOT}> calendar sync is down`, { botUserId: BOT }).body,
    null,
  );

  const long = parseMention(`<@${BOT}> ${'word '.repeat(60)}`, { botUserId: BOT });
  check('a long title is cut to fit', long.title!.length <= 121, true);
  check('and cut at a word boundary', long.title!.endsWith('…'), true);
}

section('Silence does not become a ticket');
{
  check(
    'a bare mention has no title',
    parseMention(`<@${BOT}>`, { botUserId: BOT }).title,
    null,
  );

  check(
    'nor does a mention and whitespace',
    parseMention(`<@${BOT}>   \n  `, { botUserId: BOT }).title,
    null,
  );

  // A tag alone says how urgent nothing is. Still not a ticket.
  check(
    'nor a mention and a priority tag',
    parseMention(`<@${BOT}> #urgent`, { botUserId: BOT }).title,
    null,
  );
}


// ---------------------------------------------------------------------------
section('Tagging somebody assigns it to them; tagging nobody assigns to Ally');
{
  const ALLY = { id: 'ally-hub-id', name: 'Ally' };

  check(
    'nobody tagged falls back to the default',
    chooseAssignee([], ALLY),
    { assigneeId: 'ally-hub-id', name: 'Ally', reason: 'default', alsoNotify: [], unknown: [] },
  );

  check(
    'one tagged teammate takes it',
    chooseAssignee([{ slackId: 'U1', hubUserId: 'jemie-hub-id', name: 'Jemie' }], ALLY),
    { assigneeId: 'jemie-hub-id', name: 'Jemie', reason: 'tagged', alsoNotify: [], unknown: [] },
  );

  // A ticket has one owner. The first named is the one being asked; the rest
  // are told rather than dropped.
  check(
    'two tagged: the first owns it, the second is notified',
    chooseAssignee(
      [
        { slackId: 'U1', hubUserId: 'jemie-hub-id', name: 'Jemie' },
        { slackId: 'U2', hubUserId: 'ally-hub-id', name: 'Ally' },
      ],
      ALLY,
    ),
    {
      assigneeId: 'jemie-hub-id',
      name: 'Jemie',
      reason: 'tagged',
      alsoNotify: ['ally-hub-id'],
      unknown: [],
    },
  );

  // Tagging somebody Slack knows and the Hub does not is not an error, but it
  // cannot be an assignment -- and the reply says so rather than swallowing it.
  check(
    'tagged but no Hub login: falls back, and names them',
    chooseAssignee([{ slackId: 'U9', hubUserId: null, name: 'Contractor' }], ALLY),
    {
      assigneeId: 'ally-hub-id',
      name: 'Ally',
      reason: 'default',
      alsoNotify: [],
      unknown: ['Contractor'],
    },
  );

  check(
    'a known tag still wins when an unknown one is also present',
    chooseAssignee(
      [
        { slackId: 'U9', hubUserId: null, name: 'Contractor' },
        { slackId: 'U1', hubUserId: 'jemie-hub-id', name: 'Jemie' },
      ],
      ALLY,
    ),
    {
      assigneeId: 'jemie-hub-id',
      name: 'Jemie',
      reason: 'tagged',
      alsoNotify: [],
      unknown: ['Contractor'],
    },
  );

  // The default itself can be missing -- a TECH_SUPPORT_ASSIGNEE_EMAIL matching
  // nobody. The ticket is still filed; it just has no owner.
  check(
    'no tag and no default leaves it unassigned',
    chooseAssignee([], { id: null, name: null }),
    { assigneeId: null, name: null, reason: 'nobody', alsoNotify: [], unknown: [] },
  );

  check(
    'the same person tagged twice is not notified twice',
    chooseAssignee(
      [
        { slackId: 'U1', hubUserId: 'jemie-hub-id', name: 'Jemie' },
        { slackId: 'U1', hubUserId: 'jemie-hub-id', name: 'Jemie' },
      ],
      ALLY,
    ).alsoNotify,
    [],
  );
}

section('A name typed as words is NOT a tag');
{
  // The whole reason assignment reads ids and not prose. Every one of these is
  // a real sentence somebody would write, and a name matcher would put work on
  // a person in two of the three.
  for (const text of [
    'assign this to jemie',
    'ayanda said this is broken',
    'ayanda is out today so nobody can fix it',
  ]) {
    check(
      `"${text}" tags nobody`,
      parseMention(`<@${BOT}> ${text}`, { botUserId: BOT }).mentionedUserIds,
      [],
    );
  }
}

// ---------------------------------------------------------------------------
console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : ''),
);
process.exit(failures ? 1 : 0);
