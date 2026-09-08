/**
 * Keep the BOOKING SHEET field names and its header map from drifting apart.
 *
 * WHY THIS FILE EXISTS
 *
 * One line asked for the field 'date'. The column map is keyed by FIELD name,
 * and the field is 'booked_on' — 'date' is only what the heading says in the
 * sheet. columnOf.get('date') is undefined, so every one of 384 bookings came
 * back with an empty date, while the header mapped perfectly, agent read fine,
 * disposition read fine, and booked_on was reported as mapped. Nothing looked
 * wrong anywhere.
 *
 * That is the source the live ISA pay calculation reads, and the daily bonus is
 * earned per person per DAY, so with no dates the bonus could not be computed
 * at all. It took two full runs and a round of instrumentation to find.
 *
 * The type union in the sync now makes the same slip a compile error. These
 * checks make sure the union and the map stay in step, because a union that has
 * quietly fallen behind the config stops catching anything.
 *
 *   npm run check:booking
 *
 * No database, no network, no sheet.
 */
import {
  BOOKING_SHEET_COLUMNS,
  INVALID_BOOKINGS_COLUMNS,
  PAYABLE_FIELDS,
  normaliseSheetHeader,
} from '../src/config/booking-sheet';

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

/*
 * The union declared in sync/booking-sheet, restated as a value.
 *
 * Restated rather than imported as a type, because a type cannot be iterated
 * at runtime — and the point is to compare it against the config. If somebody
 * adds a field to the union or the map, one of the checks below fails and says
 * which side is missing it.
 */
const BOOKING_FIELDS = [
  'booked_on',
  'agent',
  'patient_name',
  'patient_email',
  'location_name',
  'disposition',
] as const;

// ---------------------------------------------------------------------------
section('The field names and the header map agree');
{
  // Both widened to string[], because comparing a literal union against the
  // map's string values is the whole point and the narrow type refuses it.
  const fromMap: string[] = [...new Set(Object.values(BOOKING_SHEET_COLUMNS))].sort();
  const fromUnion: string[] = [...BOOKING_FIELDS].sort();

  check('every field in the map is in the union', fromMap, fromUnion);

  // Stated separately so a failure says which direction it drifted in.
  check(
    'nothing in the union is missing from the map',
    fromUnion.filter((field) => !fromMap.includes(field)),
    [],
  );
  check(
    'nothing in the map is missing from the union',
    fromMap.filter((field) => !fromUnion.includes(field)),
    [],
  );
}

section('A heading is not a field name');
{
  /*
   * The exact confusion that caused the bug. These are KEYS of the map — what
   * the sheet calls its columns — and not one of them may be a field name, or
   * the two namespaces overlap and the mistake becomes undetectable.
   */
  const headings = Object.keys(BOOKING_SHEET_COLUMNS);

  check('"date" is a heading', headings.includes('date'), true);
  check(
    '"date" is NOT a field name',
    (BOOKING_FIELDS as readonly string[]).includes('date'),
    false,
  );
  check('and it maps to booked_on', BOOKING_SHEET_COLUMNS['date'], 'booked_on');

  /*
   * No heading may share a name with a field. If one did, passing a heading
   * where a field belongs would silently work for that column and fail for
   * every other — which is worse than failing consistently.
   */
  const collisions = headings.filter((heading) =>
    (BOOKING_FIELDS as readonly string[]).includes(heading),
  );
  check(
    'no heading is spelled the same as a field',
    collisions,
    // 'agent' and 'disposition' are both, and legitimately: the sheet's
    // heading happens to equal the field name. Listed so the exception is
    // deliberate rather than discovered.
    ['agent', 'disposition'],
  );
}

section('The columns pay depends on');
{
  /*
   * Without an agent nobody can be paid, and without a date the daily bonus
   * cannot be grouped into days — which is exactly what went wrong. Both are
   * declared payable, and the sync refuses to import when either is absent
   * from the sheet.
   */
  check('two payable fields', PAYABLE_FIELDS.length, 2);
  check('the agent', PAYABLE_FIELDS.includes('agent'), true);
  check('the date the booking was made', PAYABLE_FIELDS.includes('booked_on'), true);
  check(
    'every payable field is a real field',
    PAYABLE_FIELDS.filter(
      (field) => !(BOOKING_FIELDS as readonly string[]).includes(field),
    ),
    [],
  );
}

section('Headings match however they are typed');
{
  const lookup = (heading: string) =>
    BOOKING_SHEET_COLUMNS[normaliseSheetHeader(heading)];

  // The live sheet's six headings, as the first successful run reported them.
  check('"Date"', lookup('Date'), 'booked_on');
  check('"Agent"', lookup('Agent'), 'agent');
  check('"Full Name"', lookup('Full Name'), 'patient_name');
  // Lower case in the sheet, which is why matching is normalised.
  check('"email"', lookup('email'), 'patient_email');
  check('"GHL Location Name"', lookup('GHL Location Name'), 'location_name');
  check('"Disposition"', lookup('Disposition'), 'disposition');

  check('padded', lookup('  Agent  '), 'agent');
  check('a doubled inner space', lookup('Full  Name'), 'patient_name');
  check('an unknown heading maps to nothing', lookup('Notes'), undefined);
}

section('The invalid-bookings tab keys the same way');
{
  /*
   * The same namespace rule, checked on the other tab, because the reason the
   * bug survived is that only one of the two readers had it wrong. Reading
   * this tab uses columnOf.get('invalid_on') and columnOf.get('reported_at') —
   * field names, correctly.
   */
  const fields = [...new Set(Object.values(INVALID_BOOKINGS_COLUMNS))].sort();
  check('its fields', fields, ['agent', 'invalid_on', 'notes', 'reason', 'reported_at']);
  check(
    '"date booked" is a heading here too, and means invalid_on',
    INVALID_BOOKINGS_COLUMNS['date booked'],
    'invalid_on',
  );
  /*
   * Worth pinning: the same heading, "date booked", means booked_on on BOOKING
   * SHEET and invalid_on on INVALID BOOKINGS. Two tabs, one spelling, two
   * meanings — so the maps must stay separate and must never be merged.
   */
  check(
    'the same heading means something different on the other tab',
    BOOKING_SHEET_COLUMNS['date booked'] !== INVALID_BOOKINGS_COLUMNS['date booked'],
    true,
  );
}

// ---------------------------------------------------------------------------
console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : ''),
);
process.exit(failures ? 1 : 0);
