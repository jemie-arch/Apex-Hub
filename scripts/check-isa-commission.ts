/**
 * Exercise the ISA commission rules.
 *
 * This decides what people are paid, and it cannot be checked against live data
 * yet: tracker_appointments.booked_by is null on all 1,281 rows until the sheet
 * sync runs. So the rules are pinned here instead, case by case, against the
 * answers Joshua gave on 3 September.
 *
 * The cases worth having are the ones a reasonable person would get wrong:
 * 7 paying the same as 6, nine paying no more than eight, the tier resetting
 * daily rather than accumulating, the booking counting against the day it was
 * made rather than the day of the appointment, and a spreadsheet's spelling of
 * "No Show" not costing somebody their bonus.
 *
 *   npm run check:commission
 *
 * No database, no network, no sheet.
 */
import { dailyBonusCents } from '../src/config/isa-commission';
import {
  type BookingRow,
  type CommissionScheme,
  classify,
  collapseDuplicates,
  commissionCentsFor,
  dailyBonusCentsFrom,
  dailyTallies,
  monthlySummaries,
  parseScheme,
  ratePerBookingCents,
  unattributedCount,
} from '../src/lib/isa-commission';

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

/** A qualifying booking: showed, and an outcome that was not a DQ. */
function booked(
  isa: string,
  createdOn: string,
  status: string | null = 'Showed',
  outcome: string | null = 'Closed',
): BookingRow {
  return {
    bookedBy: isa,
    createdOn,
    appointmentStatus: status,
    statusIfShowed: outcome,
  };
}

// ---------------------------------------------------------------------------

section('The tier table');

check('four bookings pay nothing', dailyBonusCents(4), 0);
check('five pay $10', dailyBonusCents(5), 1000);
check('six pay $20', dailyBonusCents(6), 2000);
// The original scheme jumped 6 to 8. Seven was settled at $20, not $30.
check('seven pay $20, the same as six', dailyBonusCents(7), 2000);
check('eight pay $30', dailyBonusCents(8), 3000);
// "Is there anything above 8?" — "Not yet." So this holds flat rather than
// inventing $40 for nine and paying real money against an unagreed rule.
check('nine pay no more than eight', dailyBonusCents(9), 3000);
check('twenty pay no more than eight', dailyBonusCents(20), 3000);
check('zero pays nothing', dailyBonusCents(0), 0);

section('What each booking is worth');

check(
  'showed and closed qualifies',
  classify(booked('Maria', '2026-09-01')),
  'qualifying',
);
check(
  'a follow up still qualifies — it showed and was not disqualified',
  classify(booked('Maria', '2026-09-01', 'Showed', 'Follow up')),
  'qualifying',
);
check(
  'a no show does not pay',
  classify(booked('Maria', '2026-09-01', 'No Show', null)),
  'no_show',
);
check(
  'a disqualification does not pay',
  classify(booked('Maria', '2026-09-01', 'Showed', 'DQ')),
  'unqualified',
);
check(
  'disqualified beats no-show, so the penalty denominator stays consistent',
  classify(booked('Maria', '2026-09-01', 'No Show', 'DQ')),
  'unqualified',
);
check(
  'showed with no outcome yet is pending, not a failure',
  classify(booked('Maria', '2026-09-01', 'Showed', null)),
  'pending',
);
check(
  'an appointment that has not happened is pending',
  classify(booked('Maria', '2026-09-01', null, null)),
  'pending',
);
check(
  'no ISA name means nothing can be paid against it',
  classify(booked('', '2026-09-01')),
  'unattributed',
);
check(
  'no booking date means there is no day to pay',
  classify({
    bookedBy: 'Maria',
    createdOn: null,
    appointmentStatus: 'Showed',
    statusIfShowed: 'Closed',
  }),
  'unattributed',
);

section('Spreadsheet spelling must not cost anybody money');

for (const spelling of ['No Show', 'no show', 'NO-SHOW', 'No  Show', 'noshow']) {
  check(
    `"${spelling}" reads as a no-show`,
    classify(booked('Maria', '2026-09-01', spelling, null)),
    'no_show',
  );
}

for (const spelling of ['DQ', 'dq', 'D/Q', 'Disqualified', 'disqualified ']) {
  check(
    `"${spelling}" reads as disqualified`,
    classify(booked('Maria', '2026-09-01', 'Showed', spelling)),
    'unqualified',
  );
}

section('The tier resets daily');

// Eleven qualifying bookings. Six on one day pays $20; five on another pays
// $10. A monthly re-tier would have found eleven and paid $30 once.
const acrossTwoDays = [
  ...Array.from({ length: 6 }, () => booked('Maria', '2026-09-01')),
  ...Array.from({ length: 5 }, () => booked('Maria', '2026-09-02')),
];

check(
  'six on Tuesday and five on Wednesday pay $20 + $10',
  dailyTallies(acrossTwoDays).map((day) => [day.day, day.bonusCents]),
  [
    ['2026-09-01', 2000],
    ['2026-09-02', 1000],
  ],
);

check(
  'the month sums the days rather than re-tiering the total',
  monthlySummaries(acrossTwoDays).map((month) => [
    month.isa,
    month.bonusCents,
    month.daysPaying,
  ]),
  [['Maria', 3000, 2]],
);

// Spread thin, the same eleven bookings pay nothing at all.
check(
  'four a day for three days pays nothing, despite twelve bookings',
  monthlySummaries(
    ['2026-09-01', '2026-09-02', '2026-09-03'].flatMap((day) =>
      Array.from({ length: 4 }, () => booked('Maria', day)),
    ),
  ).map((month) => [month.total, month.bonusCents]),
  [[12, 0]],
);

section('The day that counts is the day it was booked');

/*
 * Five bookings made on 1 September for appointments across October. Under the
 * confirmed rule they are one paying day in September. Had the appointment date
 * governed, they would have been five separate days in October and paid nothing.
 */
check(
  'five booked in one day for appointments spread over next month pay $10 now',
  dailyTallies(Array.from({ length: 5 }, () => booked('Maria', '2026-09-01'))).map(
    (day) => [day.day, day.qualifying, day.bonusCents],
  ),
  [['2026-09-01', 5, 1000]],
);

section('No-shows and DQs do not fill a tier');

// Eight bookings, but three failed: five qualify, so $10 and not $30.
check(
  'eight bookings of which three failed pay the five-booking tier',
  dailyTallies([
    ...Array.from({ length: 5 }, () => booked('Maria', '2026-09-01')),
    booked('Maria', '2026-09-01', 'No Show', null),
    booked('Maria', '2026-09-01', 'Showed', 'DQ'),
    booked('Maria', '2026-09-01', 'Showed', 'DQ'),
  ]).map((day) => [day.total, day.qualifying, day.bonusCents]),
  [[8, 5, 1000]],
);

section('Two ISAs are kept apart');

check(
  'five each on the same day is two paying days, not ten bookings for one',
  dailyTallies([
    ...Array.from({ length: 5 }, () => booked('Maria', '2026-09-01')),
    ...Array.from({ length: 5 }, () => booked('Sam', '2026-09-01')),
  ]).map((day) => [day.isa, day.qualifying, day.bonusCents]),
  [
    ['Maria', 5, 1000],
    ['Sam', 5, 1000],
  ],
);

check(
  'the same name with stray spacing is one person',
  dailyTallies([
    ...Array.from({ length: 3 }, () => booked('Maria', '2026-09-01')),
    ...Array.from({ length: 2 }, () => booked('  Maria  ', '2026-09-01')),
  ]).map((day) => [day.isa, day.qualifying, day.bonusCents]),
  [['Maria', 5, 1000]],
);

section('Unattributed rows are counted, not silently dropped');

const nobodyNamed = Array.from({ length: 4 }, () => booked('', '2026-09-01'));

check('four rows with no ISA are reported', unattributedCount(nobodyNamed), 4);
check(
  'and they produce no paying days rather than a zero-earning ISA',
  dailyTallies(nobodyNamed).length,
  0,
);

section('The unqualified rate is reported, never applied');

/*
 * Six bookings, two disqualified: 33%, far above the 5% the scheme describes.
 * The four qualifying bookings still pay nothing because four is below the
 * tier — but critically, the two DQs have NOT been turned into a deduction or a
 * forfeiture. What a "commission unit" is worth is still undecided.
 */
const withDqs = [
  ...Array.from({ length: 4 }, () => booked('Maria', '2026-09-01')),
  booked('Maria', '2026-09-01', 'Showed', 'DQ'),
  booked('Maria', '2026-09-01', 'Showed', 'DQ'),
];

check(
  'the rate is measured and flagged',
  monthlySummaries(withDqs).map((month) => [
    month.unqualified,
    Math.round(month.unqualifiedRate * 1000) / 10,
    month.exceedsUnqualifiedLimit,
  ]),
  [[2, 33.3, true]],
);

// Five qualifying plus two DQs: the tier is reached, so $10 is payable. If a
// penalty were being applied this would be reduced or zeroed. It is not.
check(
  'exceeding the limit does not reduce the bonus, because the rule is undefined',
  monthlySummaries([
    ...Array.from({ length: 5 }, () => booked('Maria', '2026-09-01')),
    booked('Maria', '2026-09-01', 'Showed', 'DQ'),
    booked('Maria', '2026-09-01', 'Showed', 'DQ'),
  ]).map((month) => [month.bonusCents, month.exceedsUnqualifiedLimit]),
  [[1000, true]],
);

section('Commission units — the worked example, exactly as given');

/*
 * "An ISA books 6 in a day, one is later DQ'd" — corrected on 3 September to
 * four commission units still eligible after the -2 deduction.
 *
 * Note this pins the arithmetic against the plausible wrong reading. Taking the
 * five QUALIFYING bookings and deducting two would give three. It is the full
 * booking count that is charged: 6 - 2 = 4.
 */
check(
  'six bookings, one disqualified, leaves four commission units',
  dailyTallies([
    ...Array.from({ length: 5 }, () => booked('Maria', '2026-09-01')),
    booked('Maria', '2026-09-01', 'Showed', 'DQ'),
  ]).map((day) => [day.total, day.qualifying, day.unqualified, day.commissionUnits]),
  [[6, 5, 1, 4]],
);

// A bad booking is worse than no booking: five clean is five units, and those
// same five plus one disqualified is four.
check(
  'five clean bookings are five units',
  dailyTallies(Array.from({ length: 5 }, () => booked('Maria', '2026-09-01'))).map(
    (day) => day.commissionUnits,
  ),
  [5],
);

check(
  'a no-show costs no units — only disqualification does',
  dailyTallies([
    ...Array.from({ length: 5 }, () => booked('Maria', '2026-09-01')),
    booked('Maria', '2026-09-01', 'No Show', null),
  ]).map((day) => [day.total, day.commissionUnits]),
  [[6, 6]],
);

// Above a 50% disqualification rate the deduction outweighs the bookings. Left
// negative rather than clamped: that is the case the penalty exists to surface,
// and a floor at zero would hide it.
check(
  'three bookings of which two disqualified is minus one unit, not zero',
  dailyTallies([
    booked('Maria', '2026-09-01'),
    booked('Maria', '2026-09-01', 'Showed', 'DQ'),
    booked('Maria', '2026-09-01', 'Showed', 'DQ'),
  ]).map((day) => day.commissionUnits),
  [-1],
);

check(
  'the month sums units across its days',
  monthlySummaries([
    ...Array.from({ length: 5 }, () => booked('Maria', '2026-09-01')),
    booked('Maria', '2026-09-01', 'Showed', 'DQ'),
    ...Array.from({ length: 4 }, () => booked('Maria', '2026-09-02')),
  ]).map((month) => [month.total, month.unqualified, month.commissionUnits]),
  [[10, 1, 8]],
);

section('The same booking twice');

/** A named patient at a named practice, so the collapse can see it. */
function forPatient(
  patient: string,
  createdOn: string,
  bookedFor: string,
  outcome: string | null = 'Closed',
  isa = 'Maria',
): BookingRow {
  return {
    bookedBy: isa,
    createdOn,
    appointmentStatus: outcome === null ? null : 'Showed',
    statusIfShowed: outcome,
    patientName: patient,
    locationName: 'Bright Smile Dental',
    bookedFor,
  };
}

check(
  'a straight duplicate — same patient, practice and appointment date — merges',
  (() => {
    const { rows, merged } = collapseDuplicates([
      forPatient('Ana Reyes', '2026-09-01', '2026-09-10'),
      forPatient('Ana Reyes', '2026-09-01', '2026-09-10'),
    ]);
    return [rows.length, merged];
  })(),
  [1, 1],
);

check(
  'a reschedule counts once, not twice',
  (() => {
    const { rows, merged } = collapseDuplicates([
      forPatient('Ana Reyes', '2026-09-01', '2026-09-10'),
      forPatient('Ana Reyes', '2026-09-04', '2026-09-18'),
    ]);
    return [rows.length, merged];
  })(),
  [1, 1],
);

// The day the ISA did the work is the first one. Keeping the later date would
// move the bonus to a day they only moved an appointment.
check(
  'the surviving row keeps the earliest booking day, whatever the row order',
  collapseDuplicates([
    forPatient('Ana Reyes', '2026-09-04', '2026-09-18'),
    forPatient('Ana Reyes', '2026-09-01', '2026-09-10'),
  ]).rows.map((row) => row.createdOn),
  ['2026-09-01'],
);

/*
 * And the credit follows the day. Sam booked first and Maria moved it; the
 * booking is Sam's. Comparing against whichever row arrived first would have
 * paid whoever the sheet happened to list above the other.
 */
check(
  'the ISA credited is the one who booked it, not the one who rescheduled it',
  [
    collapseDuplicates([
      forPatient('Ana Reyes', '2026-09-01', '2026-09-10', 'Closed', 'Sam'),
      forPatient('Ana Reyes', '2026-09-04', '2026-09-18', 'Closed', 'Maria'),
    ]).rows.map((row) => row.bookedBy),
    collapseDuplicates([
      forPatient('Ana Reyes', '2026-09-04', '2026-09-18', 'Closed', 'Maria'),
      forPatient('Ana Reyes', '2026-09-01', '2026-09-10', 'Closed', 'Sam'),
    ]).rows.map((row) => row.bookedBy),
  ],
  [['Sam'], ['Sam']],
);

/*
 * ...but the outcome comes from the LATEST appointment, because that is what
 * happened to the patient. Taking the first would credit an ISA for a
 * consultation that was moved and then disqualified.
 */
check(
  'and the outcome of the latest appointment',
  collapseDuplicates([
    forPatient('Ana Reyes', '2026-09-01', '2026-09-10', 'Closed'),
    forPatient('Ana Reyes', '2026-09-04', '2026-09-18', 'DQ'),
  ]).rows.map((row) => row.statusIfShowed),
  ['DQ'],
);

check(
  'the same name at a different practice is a different patient',
  (() => {
    const first = forPatient('Ana Reyes', '2026-09-01', '2026-09-10');
    const elsewhere = {
      ...forPatient('Ana Reyes', '2026-09-01', '2026-09-10'),
      locationName: 'Harbour Dental',
    };
    const { rows, merged } = collapseDuplicates([first, elsewhere]);
    return [rows.length, merged];
  })(),
  [2, 0],
);

check(
  'two different patients are left alone',
  collapseDuplicates([
    forPatient('Ana Reyes', '2026-09-01', '2026-09-10'),
    forPatient('Tom Blake', '2026-09-01', '2026-09-10'),
  ]).rows.length,
  2,
);

// Merging on absence would silently delete work, so unnamed rows pass through
// untouched however many there are.
check(
  'rows with no patient name are never merged together',
  (() => {
    const { rows, merged } = collapseDuplicates([
      booked('Maria', '2026-09-01'),
      booked('Maria', '2026-09-01'),
      booked('Maria', '2026-09-01'),
    ]);
    return [rows.length, merged];
  })(),
  [3, 0],
);

// A reschedule counted twice would have paid a tier that was never earned.
check(
  'five patients booked once each pay $10 even when three rescheduled',
  (() => {
    const { rows } = collapseDuplicates([
      forPatient('A', '2026-09-01', '2026-09-10'),
      forPatient('B', '2026-09-01', '2026-09-10'),
      forPatient('C', '2026-09-01', '2026-09-10'),
      forPatient('D', '2026-09-01', '2026-09-10'),
      forPatient('E', '2026-09-01', '2026-09-10'),
      forPatient('A', '2026-09-01', '2026-09-20'),
      forPatient('B', '2026-09-01', '2026-09-21'),
      forPatient('C', '2026-09-01', '2026-09-22'),
    ]);
    return dailyTallies(rows).map((day) => [day.total, day.bonusCents]);
  })(),
  [[5, 1000]],
);

section('The scheme as the sheet actually defines it');

/*
 * The real figures, read from INPUT VALUES on the Call Center Agent Dashboard:
 * $8 per booking below 96, $10 below 128, $12 above; daily bonus $10/$20/$30 at
 * 5/6/8; two bookings lost per invalid booking.
 */
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

// Karol Sanchez, 75 bookings, is $600.00 on the live dashboard. Ayanda, 69, is
// $552.00. Both reproduced here, which is the only evidence available that this
// matches what the sheet pays.
check('75 bookings pay $600, as the dashboard shows', commissionCentsFor(75, SHEET), 60000);
check('69 bookings pay $552, as the dashboard shows', commissionCentsFor(69, SHEET), 55200);

check('95 bookings are still on the $8 rate', ratePerBookingCents(95, SHEET), 800);
check('96 bookings step up to $10', ratePerBookingCents(96, SHEET), 1000);
check('127 bookings are still $10', ratePerBookingCents(127, SHEET), 1000);
check('128 bookings step up to $12', ratePerBookingCents(128, SHEET), 1200);
check('96 bookings pay $960, not $768', commissionCentsFor(96, SHEET), 96000);

// Negative units earn nothing rather than owing money.
check('negative units pay zero, not a debt', commissionCentsFor(-3, SHEET), 0);
check('zero units pay zero', commissionCentsFor(0, SHEET), 0);

check(
  'the sheet-driven daily bonus matches the hardcoded one at every tier',
  [4, 5, 6, 7, 8, 9, 20].map((count) => dailyBonusCentsFrom(count, SHEET)),
  [4, 5, 6, 7, 8, 9, 20].map((count) => dailyBonusCents(count)),
);

/*
 * Seven is the case the two live formulas disagree on. STATS DASHBOARD!P2 uses
 * >= and pays $20; TODAY'S DATA!M3 uses = on tiers 1 and 2, so seven matches no
 * branch and pays nothing. Joshua confirmed seven pays $20, so the dashboard is
 * authoritative and this follows it.
 */
check('seven bookings pay $20, following the dashboard', dailyBonusCentsFrom(7, SHEET), 2000);

section('A stored scheme is taken whole or not at all');

check('the real scheme parses', parseScheme({ ...SHEET })?.unitAmount ?? null, 800);
check('a missing field discards the lot', parseScheme({ unitAmount: 800 }), null);
check(
  'a field that is not a number discards the lot',
  parseScheme({ ...SHEET, tier2Threshold: '6' }),
  null,
);
check('null is not a scheme', parseScheme(null), null);
check('a number is not a scheme', parseScheme(800), null);

section('An empty month is not an error');

check('no rows means no summaries', monthlySummaries([]), []);
check('no rows means no days', dailyTallies([]), []);

// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? `\n${checks}/${checks} checks passed`
    : `\n${failures} of ${checks} checks FAILED`,
);

process.exit(failures === 0 ? 0 : 1);
