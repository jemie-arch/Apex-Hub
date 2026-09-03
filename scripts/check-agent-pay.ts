/**
 * Exercise the pay calculation against the live sheet's own formula.
 *
 * These are not checks of what I think the scheme should be. They pin the
 * behaviour of DAILY BONUS TALLY!B3 and STATS DASHBOARD!O2/P2 as they are
 * written today, because the whole value of this module is that its figures can
 * be reconciled against what agents are already paid.
 *
 * The cases that matter are the ones where the formula does something a
 * reasonable person would not predict: the penalty landing before the tier
 * rather than after the bonus, an invalid report for an agent with no bookings,
 * and no outcome filter at all.
 *
 *   npm run check:pay
 *
 * No database, no network, no sheet.
 */
import {
  type AgentBooking,
  type InvalidReport,
  agentDays,
  agentMonths,
} from '../src/lib/agent-pay';
import type { CommissionScheme } from '../src/lib/isa-commission';
import { parseSheetDate } from '../src/lib/sheet-dates';

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

/** The real figures from INPUT VALUES. */
const SHEET: CommissionScheme = {
  unitAmount: 800,
  quota1Amount: 1000,
  quota2Amount: 1200,
  quota1Threshold: 96,
  quota2Threshold: 128,
  tier1Bonus: 1000,
  tier2Bonus: 2000,
  tier3Bonus: 3000,
  tier1Threshold: 5,
  tier2Threshold: 6,
  tier3Threshold: 8,
  bookingsLostPerInvalid: 2,
};

function booking(
  agent: string | null,
  bookedOn: string | null,
  disposition: string | null = 'Showed',
): AgentBooking {
  return { agent, bookedOn, disposition };
}

function report(agent: string, invalidOn: string): InvalidReport {
  return { agent, invalidOn };
}

function many(count: number, agent: string, day: string): AgentBooking[] {
  return Array.from({ length: count }, () => booking(agent, day));
}

// ---------------------------------------------------------------------------

section('Which month a date falls in');

/*
 * BOOKING SHEET is M/D/YYYY. Established from Google's own column summary: min
 * 7/10/2026, max 9/3/2026. Under D/M/YYYY the min would have been the September
 * value, and it was not — so 7/10/2026 is 10 July.
 *
 * This is checked because it decides which pay period a booking lands in, and
 * getting it wrong is silent: every date still parses, every total still adds
 * up, and the money is attributed to the wrong month.
 */
check(
  'BOOKING SHEET: 7/10/2026 is 10 July',
  parseSheetDate('7/10/2026', 'month-first').date,
  '2026-07-10',
);
check(
  'BOOKING SHEET: 9/3/2026 is 3 September, so the column sorts ascending',
  parseSheetDate('9/3/2026', 'month-first').date,
  '2026-09-03',
);

// APPOINTMENT DATA uses the opposite convention: 01-07-2026 sits on a row whose
// own Month column reads July. Joining the two tabs on a single rule would
// misalign them without failing.
check(
  'APPOINTMENT DATA: 01-07-2026 is 1 July under day-first',
  parseSheetDate('01-07-2026', 'day-first').date,
  '2026-07-01',
);
check(
  'the same string read month-first would be 7 January — the trap',
  parseSheetDate('01-07-2026', 'month-first').date,
  '2026-01-07',
);

// A value above 12 cannot be a month, so it settles the order itself and
// overrides the declared convention rather than deferring to it.
check(
  'a day above 12 overrides the convention',
  [
    parseSheetDate('7/25/2026', 'day-first').date,
    parseSheetDate('25/7/2026', 'month-first').date,
  ],
  ['2026-07-25', '2026-07-25'],
);
check(
  'and is not flagged as ambiguous, because it is not',
  parseSheetDate('7/25/2026', 'month-first').ambiguous,
  false,
);
check(
  'an ambiguous value is flagged even though it parses',
  parseSheetDate('7/10/2026', 'month-first').ambiguous,
  true,
);

check(
  'ISO passes through untouched',
  parseSheetDate('2026-07-10', 'day-first').date,
  '2026-07-10',
);
check(
  'both halves above 12 is not a date',
  parseSheetDate('25/25/2026', 'month-first').date,
  null,
);
check('an empty cell is null, not today', parseSheetDate('', 'month-first').date, null);
check('so is a label', parseSheetDate('Dental Illusions', 'month-first').date, null);

section('The daily tally, as the sheet computes it');

check(
  'five bookings on a day pay $10',
  agentDays(many(5, 'Karol Sanchez', '2026-09-01'), [], SHEET).map((d) => [
    d.bookings,
    d.countable,
    d.bonusCents,
  ]),
  [[5, 5, 1000]],
);

check(
  'eight pay $30',
  agentDays(many(8, 'Karol Sanchez', '2026-09-01'), [], SHEET).map((d) => d.bonusCents),
  [3000],
);

/*
 * The property that decides real money and is easy to get backwards: the
 * penalty is subtracted BEFORE the tier is read. Six bookings with one invalid
 * is four countable, which is below five, so the day pays NOTHING — not $20
 * reduced by something.
 */
check(
  'six bookings with one invalid pay nothing, not a reduced $20',
  agentDays(many(6, 'Karol Sanchez', '2026-09-01'), [report('Karol Sanchez', '2026-09-01')], SHEET)
    .map((d) => [d.bookings, d.invalid, d.countable, d.bonusCents]),
  [[6, 1, 4, 0]],
);

check(
  'eight with one invalid drop to the six-booking tier',
  agentDays(many(8, 'Karol Sanchez', '2026-09-01'), [report('Karol Sanchez', '2026-09-01')], SHEET)
    .map((d) => [d.countable, d.bonusCents]),
  [[6, 2000]],
);

check(
  'ten with one invalid stay on the top tier',
  agentDays(many(10, 'Karol Sanchez', '2026-09-01'), [report('Karol Sanchez', '2026-09-01')], SHEET)
    .map((d) => [d.countable, d.bonusCents]),
  [[8, 3000]],
);

check(
  'two invalid reports cost four bookings',
  agentDays(
    many(9, 'Karol Sanchez', '2026-09-01'),
    [report('Karol Sanchez', '2026-09-01'), report('Karol Sanchez', '2026-09-01')],
    SHEET,
  ).map((d) => [d.invalid, d.countable, d.bonusCents]),
  [[2, 5, 1000]],
);

section('The tier resets daily, and the penalty lands on its own day');

check(
  'an invalid booking on Tuesday does not touch Wednesday',
  agentDays(
    [...many(6, 'Karol Sanchez', '2026-09-01'), ...many(6, 'Karol Sanchez', '2026-09-02')],
    [report('Karol Sanchez', '2026-09-01')],
    SHEET,
  ).map((d) => [d.day, d.countable, d.bonusCents]),
  [
    ['2026-09-01', 4, 0],
    ['2026-09-02', 6, 2000],
  ],
);

section('No outcome filter, which is what the live formula does');

/*
 * Eight bookings of which three are no-shows still pay the eight-booking tier,
 * because the formula counts rows and never looks at disposition. This
 * contradicts "no-shows and disqualifications do not pay" as described, and the
 * check exists to make the disagreement explicit rather than to endorse it.
 */
const mixed = [
  ...many(5, 'Karol Sanchez', '2026-09-01'),
  booking('Karol Sanchez', '2026-09-01', 'No Show'),
  booking('Karol Sanchez', '2026-09-01', 'No Show'),
  booking('Karol Sanchez', '2026-09-01', 'DQ'),
];

check(
  'by default every row counts, whatever the disposition',
  agentDays(mixed, [], SHEET).map((d) => [d.bookings, d.bonusCents]),
  [[8, 3000]],
);

check(
  'with the filter on, the same day pays the five-booking tier',
  agentDays(mixed, [], SHEET, {
    qualifyingOnly: true,
    qualifies: (row) => row.disposition === 'Showed',
  }).map((d) => [d.bookings, d.bonusCents]),
  [[5, 1000]],
);

section('Rows that belong to nobody');

check(
  'a blank agent contributes to no day at all',
  agentDays([...many(5, 'Karol Sanchez', '2026-09-01'), booking(null, '2026-09-01')], [], SHEET)
    .map((d) => [d.agent, d.bookings]),
  [['Karol Sanchez', 5]],
);

check(
  'a booking with no date contributes to no day',
  agentDays([...many(5, 'Karol Sanchez', '2026-09-01'), booking('Karol Sanchez', null)], [], SHEET)
    .map((d) => d.bookings),
  [5],
);

/*
 * An invalid report whose agent matches nothing on BOOKING SHEET produces a
 * negative day rather than vanishing. The form field is free text, so a typo
 * there would otherwise cost nobody anything with nothing saying so.
 */
check(
  'a report for an unknown agent shows as a negative day, not silence',
  agentDays(many(5, 'Karol Sanchez', '2026-09-01'), [report('Krol Sanchez', '2026-09-01')], SHEET)
    .map((d) => [d.agent, d.bookings, d.invalid, d.countable, d.bonusCents]),
  [
    ['Karol Sanchez', 5, 0, 5, 1000],
    ['Krol Sanchez', 0, 1, -2, 0],
  ],
);

check(
  'stray spacing around a name is the same person',
  agentDays(
    [...many(3, 'Karol Sanchez', '2026-09-01'), ...many(2, '  Karol Sanchez ', '2026-09-01')],
    [],
    SHEET,
  ).map((d) => [d.agent, d.bookings, d.bonusCents]),
  [['Karol Sanchez', 5, 1000]],
);

section('The month: bonus summed daily, commission applied once');

/*
 * Karol Sanchez shows 75 bookings and $600.00 of Comms on the live dashboard.
 * Spread as 75 single-booking days no bonus is earned, so the month is
 * commission only — and it has to come to exactly $600.
 */
const seventyFive = Array.from({ length: 75 }, (_unused, index) =>
  booking('Karol Sanchez', `2026-09-${String((index % 30) + 1).padStart(2, '0')}`),
);

check(
  '75 bookings across the month give $600 of commission, as the dashboard shows',
  agentMonths(seventyFive, [], SHEET).map((m) => [m.bookings, m.countable, m.commissionCents]),
  [[75, 75, 60000]],
);

check(
  'the month sums the daily bonuses rather than re-tiering the total',
  agentMonths(
    [...many(6, 'Karol Sanchez', '2026-09-01'), ...many(5, 'Karol Sanchez', '2026-09-02')],
    [],
    SHEET,
  ).map((m) => [m.bookings, m.bonusCents, m.daysPaying]),
  [[11, 3000, 2]],
);

check(
  'bonus and commission are added, not chosen between',
  agentMonths(many(6, 'Karol Sanchez', '2026-09-01'), [], SHEET).map((m) => [
    m.bonusCents,
    m.commissionCents,
    m.totalCents,
  ]),
  // Six bookings: $20 bonus for the day, plus 6 x $8 commission.
  [[2000, 4800, 6800]],
);

check(
  'an invalid booking reduces commission as well as the bonus',
  agentMonths(many(6, 'Karol Sanchez', '2026-09-01'), [report('Karol Sanchez', '2026-09-01')], SHEET)
    .map((m) => [m.countable, m.bonusCents, m.commissionCents, m.totalCents]),
  // Four countable: no tier reached, and 4 x $8 of commission.
  [[4, 0, 3200, 3200]],
);

check(
  'two agents are kept apart',
  agentMonths(
    [...many(5, 'Ayanda Ndlovu', '2026-09-01'), ...many(5, 'Karol Sanchez', '2026-09-01')],
    [],
    SHEET,
  ).map((m) => [m.agent, m.totalCents]),
  [
    ['Ayanda Ndlovu', 1000 + 4000],
    ['Karol Sanchez', 1000 + 4000],
  ],
);

check('no bookings means no months', agentMonths([], [], SHEET), []);
check('no bookings means no days', agentDays([], [], SHEET), []);

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? `\n${checks}/${checks} checks passed`
    : `\n${failures} of ${checks} checks FAILED`,
);

process.exit(failures === 0 ? 0 : 1);
