/**
 * Exercise the Client Fulfilment Tracker aggregation.
 *
 * This decides what numbers Josh reads instead of opening the spreadsheet, so
 * the cases pinned here are the ones where a plausible implementation is wrong
 * rather than the ones that are obviously right:
 *
 *   - ratios computed from summed counters, never averaged across days
 *   - the two feeds unioned by client, not left-joined from the ad side
 *   - call columns ABSENT at campaign grain, not zero and not repeated
 *   - totals recomputed from the summed counters, not summed from row ratios
 *   - a zero denominator giving blank, not zero
 *
 *   npm run check:cft
 *
 * No database, no network, no sheet.
 */
import { COLUMNS, LETTERS, SECTIONS } from '../src/lib/cft-columns';
import {
  type CallViewRow,
  type StatsViewRow,
  aggregate,
  derive,
  sortRows,
  windowFor,
} from '../src/lib/cft-stats';

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

function stat(over: Partial<StatsViewRow> = {}): StatsViewRow {
  return {
    client_id: 'c1',
    client_name: 'Bright Smile',
    status: 'Active',
    campaign_name: 'Implants',
    campaign_id_external: '111',
    offer_name: 'Free consult',
    spend_cents: 0,
    leads_best: 0,
    appts_created: 0,
    appts_to_be_taken: 0,
    last_appt_date: null,
    shows: 0,
    no_shows: 0,
    cancels: 0,
    dqs: 0,
    closes: 0,
    ...over,
  };
}

function call(over: Partial<CallViewRow> = {}): CallViewRow {
  return {
    client_id: 'c1',
    client_name: 'Bright Smile',
    dialed_calls: 0,
    calls_2min: 0,
    connected_outbound: 0,
    speed_to_lead_min_sum: 0,
    speed_to_lead_n: 0,
    speed_to_lead_over_24h: 0,
    ...over,
  };
}

const campaign = { breakdown: 'campaign' as const };
const client = { breakdown: 'client' as const };

// ---------------------------------------------------------------------------

section('Aggregate first, then divide');

/*
 * The whole contract in one case. Two days: one with 1 lead at $100 spend, one
 * with 99 leads at $100 spend. The right CPL is 200/100 = $2.00.
 *
 * Averaging the daily CPLs gives (100 + 1.01) / 2 = $50.51 — twenty-five times
 * too high, and entirely plausible-looking on a page.
 */
const lopsided = aggregate(
  [
    stat({ spend_cents: 10_000, leads_best: 1 }),
    stat({ spend_cents: 10_000, leads_best: 99 }),
  ],
  [],
  campaign,
);

check('two days collapse to one campaign row', lopsided.rows.length, 1);
check(
  'CPL is total spend over total leads, not the mean of daily CPLs',
  derive(lopsided.rows[0]!).cpl,
  2,
);

check(
  'Show % is total shows over total appointments',
  derive(
    aggregate(
      [
        stat({ appts_created: 1, shows: 1 }),
        stat({ appts_created: 99, shows: 0 }),
      ],
      [],
      campaign,
    ).rows[0]!,
  ).showPct,
  0.01,
);

section('A zero denominator is blank, not zero');

const spendNoLeads = aggregate([stat({ spend_cents: 50_000 })], [], campaign);
const d = derive(spendNoLeads.rows[0]!);

check('CPL with no leads', d.cpl, null);
check('Schedule % with no leads', d.schedulePct, null);
check('Show % with no appointments', d.showPct, null);
check('Close % with no shows', d.closePct, null);
check('Cost Per Show with no shows', d.costPerShow, null);
// The spend is real and still shown; only the ratios are unknowable.
check('the spend itself is kept', spendNoLeads.rows[0]!.spendCents, 50_000);

section('Call data has no campaign grain');

const withCalls = aggregate(
  [
    stat({ campaign_id_external: '111', spend_cents: 1000, leads_best: 10 }),
    stat({ campaign_id_external: '222', spend_cents: 1000, leads_best: 10 }),
  ],
  [call({ dialed_calls: 80, calls_2min: 8, connected_outbound: 79 })],
  campaign,
);

check('two campaigns for one client stay two rows', withCalls.rows.length, 2);
/*
 * Absent, not zero. Repeating the client's 80 dials on both campaign rows would
 * report 160 dials for 80 calls; showing 0 would claim the campaigns made no
 * calls, which is also false. The only true answer at this grain is "unknown".
 */
check(
  'neither campaign row carries call counters',
  withCalls.rows.map((row) => row.calls === undefined),
  [true, true],
);
check(
  'so the call-derived figures are blank',
  withCalls.rows.map((row) => derive(row).pickupPct),
  [null, null],
);

const byClient = aggregate(
  [
    stat({ campaign_id_external: '111', spend_cents: 1000, leads_best: 10 }),
    stat({ campaign_id_external: '222', spend_cents: 1000, leads_best: 10 }),
  ],
  [call({ dialed_calls: 80, calls_2min: 8, connected_outbound: 79 })],
  client,
);

check('the client breakdown is one row', byClient.rows.length, 1);
check('and it carries the calls once', byClient.rows[0]!.calls?.dialed, 80);
check(
  'Pickup % is connected outbound over dialed',
  derive(byClient.rows[0]!).pickupPct,
  79 / 80,
);
check(
  'Dials per Lead spans both campaigns of that client',
  derive(byClient.rows[0]!).dialsPerLead,
  4,
);

section('The two feeds are unioned, not joined');

/*
 * Eight of forty-two clients have call activity and no ad spend over a thirty
 * day window. A left join from the stats side drops them and the client count
 * silently disagrees with the sheet.
 */
const unioned = aggregate(
  [stat({ client_id: 'c1', spend_cents: 1000 })],
  [
    call({ client_id: 'c1', dialed_calls: 10 }),
    call({ client_id: 'c2', client_name: 'Harbour Dental', dialed_calls: 25 }),
  ],
  client,
);

check('the call-only client gets a row', unioned.rows.length, 2);
check(
  'with its calls and no spend',
  unioned.rows
    .map((row) => [row.clientName, row.spendCents, row.calls?.dialed])
    .sort(),
  [
    ['Bright Smile', 1000, 10],
    ['Harbour Dental', 0, 25],
  ],
);
check(
  'and it appears in the client filter',
  unioned.clients.map((entry) => entry.name),
  ['Bright Smile', 'Harbour Dental'],
);

section('Appointments with no campaign keep their own row');

// 118 of 1,281 tracker appointments carry no campaign id. They are real
// appointments; folding them into a named campaign would misattribute them.
const noCampaign = aggregate(
  [
    stat({ campaign_id_external: '111', campaign_name: 'Implants', appts_created: 3 }),
    stat({ campaign_id_external: null, campaign_name: null, appts_created: 2 }),
  ],
  [],
  campaign,
);

check('they are not filtered out', noCampaign.rows.length, 2);
check(
  'and not merged into a named campaign',
  noCampaign.rows.map((row) => [row.campaignName, row.apptsCreated]).sort(),
  [
    [null, 2],
    ['Implants', 3],
  ],
);

section('Totals are recomputed, never summed from the rows');

/*
 * Three campaigns, wildly different volumes. The totals row must divide the
 * summed counters — adding the three CPLs, or averaging them, both give a
 * figure that is not the cost per lead of anything.
 */
const many = aggregate(
  [
    stat({ campaign_id_external: 'a', spend_cents: 10_000, leads_best: 1, appts_created: 1, shows: 1 }),
    stat({ campaign_id_external: 'b', spend_cents: 10_000, leads_best: 99, appts_created: 10, shows: 2 }),
    stat({ campaign_id_external: 'c', spend_cents: 30_000, leads_best: 400, appts_created: 40, shows: 20 }),
  ],
  [],
  campaign,
);

check('the counters add up', [many.totals.spendCents, many.totals.leads, many.totals.shows], [50_000, 500, 23]);
check('total CPL divides the sums', derive(many.totals).cpl, 500 / 500);
check('total Show % divides the sums', derive(many.totals).showPct, 23 / 51);
// The mean of the three rows' Show % is 0.617; the true figure is 0.451.
check(
  'which is not the mean of the row percentages',
  Math.abs(derive(many.totals).showPct! - 0.617) > 0.15,
  true,
);

check(
  'rows sort by spend, descending',
  many.rows.map((row) => row.spendCents),
  [30_000, 10_000, 10_000],
);

section('Last Appt Date is a maximum, not a sum');

check(
  'the latest date across the window wins',
  aggregate(
    [
      stat({ last_appt_date: '2026-08-11' }),
      stat({ last_appt_date: '2026-08-29' }),
      stat({ last_appt_date: null }),
    ],
    [],
    campaign,
  ).rows[0]!.lastApptDate,
  '2026-08-29',
);

section('The client filter');

const filtered = aggregate(
  [
    stat({ client_id: 'c1', spend_cents: 1000 }),
    stat({ client_id: 'c2', client_name: 'Harbour Dental', spend_cents: 9000 }),
  ],
  [call({ client_id: 'c2', client_name: 'Harbour Dental', dialed_calls: 40 })],
  { ...client, clientId: 'c2' },
);

check('narrows the rows', filtered.rows.map((row) => row.clientName), ['Harbour Dental']);
check('and the totals', filtered.totals.spendCents, 9000);
check('and the calls with them', filtered.totals.calls?.dialed, 40);
// The picker still lists everybody, or you could not switch back.
check('but not the client list', filtered.clients.length, 2);

section('The window');

check(
  'three days is inclusive of today',
  windowFor(3, new Date('2026-09-04T12:00:00Z')),
  { from: '2026-09-02', to: '2026-09-04' },
);
check(
  'thirty days ending 4 September is the verification window',
  windowFor(30, new Date('2026-09-04T12:00:00Z')),
  { from: '2026-08-06', to: '2026-09-04' },
);

section('Empty input');

const nothing = aggregate([], [], campaign);
check('no rows', nothing.rows.length, 0);
check('totals are zero rather than absent', nothing.totals.spendCents, 0);
check('and its CPL is blank', derive(nothing.totals).cpl, null);

section('The column model matches the sheet');

check('thirty-three columns', COLUMNS.length, 33);
check('lettered A to AG in order', COLUMNS.map((c) => c.letter), LETTERS);
check('and the letters end at AG', LETTERS[32], 'AG');
check(
  'the six section headers span every column',
  SECTIONS.reduce((total, s) => total + s.span, 0),
  33,
);
check(
  'the sections are the sheet\x27s, in order',
  SECTIONS.map((s) => s.label),
  ['', 'CAMPAIGN INFORMATION', '1. AD DATA', '2. CALL DATA', '3. APPOINTMENT DATA', '4. DEALS', '5. KPI METRICS'],
);
// Columns J to O are the call block, and the only ones hatched at campaign grain.
check(
  'exactly the call columns are blocked in a campaign breakdown',
  COLUMNS.filter((c) => c.blockedAt?.('campaign')).map((c) => c.letter),
  ['J', 'K', 'L', 'M', 'N', 'O'],
);
check(
  'and none of them are blocked at client grain',
  COLUMNS.filter((c) => c.blockedAt?.('client')).length,
  0,
);
check(
  'three columns have no Hub source at all',
  COLUMNS.filter((c) => c.noSource).map((c) => c.letter),
  ['A', 'AC', 'AD'],
);

section('Sorting');

const forSort = [
  { n: 3 as number | string | null },
  { n: 1 },
  { n: 2 },
];

check(
  'descending is the default direction',
  sortRows(forSort, (r) => r.n, 'desc').map((r) => r.n),
  [3, 2, 1],
);
check(
  'ascending reverses it',
  sortRows(forSort, (r) => r.n, 'asc').map((r) => r.n),
  [1, 2, 3],
);

/*
 * Blanks sink in BOTH directions. A campaign with no leads has no CPL, and
 * letting null sort as zero parks every unmeasurable row at the top of
 * "cheapest cost per lead" — the most expensive misreading available on a page
 * somebody scans to decide where to put money.
 */
const withBlanks = [{ n: 2 as number | null }, { n: null }, { n: 1 }];
check(
  'blanks sink when sorting ascending',
  sortRows(withBlanks, (r) => r.n, 'asc').map((r) => r.n),
  [1, 2, null],
);
check(
  'and when sorting descending',
  sortRows(withBlanks, (r) => r.n, 'desc').map((r) => r.n),
  [2, 1, null],
);
check(
  'text sorts as text, not by code point accident',
  sortRows([{ n: 'b' as string }, { n: 'A' }, { n: 'c' }], (r) => r.n, 'asc').map((r) => r.n),
  ['A', 'b', 'c'],
);
// Sorting reads the value, not the rendered string: 9 must sit below 10.
check(
  'numbers sort numerically',
  sortRows([{ n: 9 as number }, { n: 10 }, { n: 100 }], (r) => r.n, 'asc').map((r) => r.n),
  [9, 10, 100],
);

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? `\n${checks}/${checks} checks passed`
    : `\n${failures} of ${checks} checks FAILED`,
);

process.exit(failures === 0 ? 0 : 1);
