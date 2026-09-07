/**
 * Exercise the Client Fulfilment Tracker's header mapping.
 *
 * The mapping is the whole risk in that sync. Reading the live onboarding form
 * on 2 September found two of its four mapped question labels had been
 * rewritten since the stored payloads were captured, and both would have failed
 * silently — a question nobody asks and a question nobody answers are the same
 * absence downstream. The tracker is worked in every day by people who add and
 * rename columns, so it will drift the same way.
 *
 * These checks pin the properties that keep that drift visible rather than
 * silent: matching ignores case and spacing, no spelling means two fields, and
 * an unrecognised header is reported rather than dropped.
 *
 *   npm run check:tracker
 *
 * No database, no network, no sheet.
 */
import {
  HEADER_TO_FIELD,
  IGNORED_HEADERS,
  REQUIRED_FIELDS,
  TRACKER_COLUMNS,
  normaliseHeader,
} from '../src/config/fulfilment-tracker';
import {
  parseTrackerDateForTests as asDate,
  parseTrackerMoneyForTests as asCents,
} from '../src/lib/sync/fulfilment-tracker';

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

// ---------------------------------------------------------------------------
section('Headers match however they are typed');
{
  const lookup = (header: string) => HEADER_TO_FIELD.get(normaliseHeader(header));

  check('exact', lookup('Booked By'), 'booked_by');
  check('lowercase', lookup('booked by'), 'booked_by');
  check('shouted', lookup('BOOKED BY'), 'booked_by');
  check('padded', lookup('   Booked By   '), 'booked_by');
  // A sheet worked in by hand collects double spaces nobody can see.
  check('a doubled inner space', lookup('Booked  By'), 'booked_by');
  check('an unknown header maps to nothing', lookup('Notes For Later'), undefined);
}

section('The tracker as it actually is — row 4, columns A to N');
{
  /*
   * Not invented. This is what the sheet returned on the first successful
   * read, 7 September 2026.
   *
   * It is pinned because the header list used to be guessed from the shape of
   * the database table, which is how the import came to demand a column called
   * "booked for" from a sheet that calls it "Date Booked" — and refuse to write
   * a single row while sitting on 1,300 of them.
   *
   * Rename a column in the tracker and this section fails and names it.
   */
  const SHEET_ROW_4 = [
    'Month Created',
    'Month Booked',
    'Date Created',
    'Date Booked',
    'Location Name',
    'Name',
    'Email',
    'Campaign ID',
    'Ad Set ID',
    'Ad ID',
    'Offer Name',
    'Appointment Status',
    'Status if Showed',
    'Amount Spent',
  ];

  const ignored = new Set(IGNORED_HEADERS.map(normaliseHeader));
  const placed = (header: string) =>
    HEADER_TO_FIELD.get(normaliseHeader(header)) !== undefined ||
    ignored.has(normaliseHeader(header));

  check('fourteen headings', SHEET_ROW_4.length, 14);
  check(
    'every one is mapped, or ignored on purpose',
    SHEET_ROW_4.filter((header) => !placed(header)),
    [],
  );

  /*
   * The two dates sit three words apart in the sheet and mean opposite ends of
   * the same appointment. Reading them the wrong way round would move every
   * consultation in the Hub to the day it was set, and nothing downstream
   * could tell.
   */
  check('"Date Booked" is the appointment', HEADER_TO_FIELD.get('date booked'), 'booked_for');
  check('"Date Created" is the booking', HEADER_TO_FIELD.get('date created'), 'created_on');
  check('"Amount Spent" is read', HEADER_TO_FIELD.get('amount spent'), 'amount_spent');

  /*
   * The finding that matters most in this file. Fourteen headings and not one
   * names a person, so the tracker cannot attribute an appointment to an ISR —
   * which is what this sync was originally built to do. Attribution comes from
   * BOOKING SHEET column B instead.
   *
   * Asserted rather than written in a comment so that adding the column to the
   * sheet fails this check and forces somebody to decide which source wins.
   */
  check(
    'the sheet has NO column naming who booked',
    SHEET_ROW_4.filter((header) => HEADER_TO_FIELD.get(normaliseHeader(header)) === 'booked_by'),
    [],
  );

  check('the month labels are ignored, not unrecognised', [...ignored].sort(), [
    'month booked',
    'month created',
  ]);
  check(
    'nothing is both ignored and mapped',
    IGNORED_HEADERS.filter((header) => HEADER_TO_FIELD.has(normaliseHeader(header))),
    [],
  );
}

section('Dates as the sheet displays them');
{
  // Read as FORMATTED_VALUE, so these arrive the way a person sees them.
  check('M/D/YYYY, which is what the tracker shows', asDate('9/4/2026'), '2026-09-04');
  check('zero-padded', asDate('09/04/2026'), '2026-09-04');
  check('already ISO', asDate('2026-09-04'), '2026-09-04');
  check('blank is absent, not the epoch', asDate(''), null);
  check('undefined is absent', asDate(undefined), null);
  // booked_for drives billing windows. A date invented from an ambiguous
  // string would be wrong in a way nothing downstream could detect.
  check('nonsense is absent, never a guess', asDate('TBC'), null);
}

section('Amount Spent, typed by hand into column N');
{
  check('plain', asCents('1234.56'), 123456);
  check('with a symbol and separators', asCents('$1,234.56'), 123456);
  check('whole dollars', asCents('$40'), 4000);
  // Rounded, so a column of odd fractions does not drift by a cent a row.
  check('a fraction of a cent rounds', asCents('10.005'), 1001);
  // A spreadsheet means negative by parentheses.
  check('accounting parentheses are negative', asCents('($12.34)'), -1234);
  check('a leading minus is negative', asCents('-12.34'), -1234);
  /*
   * The distinction this parser exists to keep: nobody typed anything, versus
   * somebody typed zero. Only the second is a cost of nothing.
   */
  check('blank is unknown', asCents(''), null);
  check('a stray dash is unknown', asCents('-'), null);
  check('text is unknown', asCents('n/a'), null);
  check('but a real zero is zero', asCents('$0.00'), 0);
}

section('The columns the bonus depends on');
{
  /*
   * Kept mapped although the tracker turned out not to have the column. The
   * spellings cost nothing and the sheet gains columns regularly, so the day
   * one appears it is imported without a code change.
   *
   * What must not be read into this section is that attribution works. The
   * ISR bonus — 5 appointments a day pays $1,000, 6 pays $2,000, 8 pays
   * $3,000 — is calculated from BOOKING SHEET, not from here.
   */
  const bookedBy = TRACKER_COLUMNS.find((column) => column.field === 'booked_by');
  check('booked_by is mapped', bookedBy !== undefined, true);
  check('and accepts more than one spelling', (bookedBy?.headers.length ?? 0) > 1, true);
  check('"agent" reaches it', HEADER_TO_FIELD.get('agent'), 'booked_by');
  check('"isr" reaches it', HEADER_TO_FIELD.get('isr'), 'booked_by');
}

section('Only name and date are required');
{
  // A row missing either is not an appointment anybody can act on. Everything
  // else may legitimately be blank, and refusing those rows would import less
  // than the sheet contains.
  check('exactly two required fields', REQUIRED_FIELDS.length, 2);
  check('patient name', REQUIRED_FIELDS.includes('patient_name'), true);
  check('appointment date', REQUIRED_FIELDS.includes('booked_for'), true);
  check('status is not required', REQUIRED_FIELDS.includes('appointment_status'), false);
  check('booked_by is not required', REQUIRED_FIELDS.includes('booked_by'), false);
}

section('No spelling means two different things');
{
  // HEADER_TO_FIELD throws at module load on a collision, so reaching this line
  // is itself the assertion. Counted explicitly so the reason is recorded.
  const spellings = TRACKER_COLUMNS.flatMap((column) => column.headers);
  const distinct = new Set(spellings.map(normaliseHeader));
  check('every spelling is unique once normalised', distinct.size, spellings.length);
  check('the map holds all of them', HEADER_TO_FIELD.size, distinct.size);
}

section('Every mapped field is a real tracker column');
{
  /*
   * Guards the failure that has no symptom: a field named here that does not
   * exist on tracker_appointments would be sent in the upsert and rejected by
   * Postgres for the whole batch, so one typo loses every row.
   */
  const REAL = new Set([
    'location_name', 'patient_name', 'patient_email', 'created_on', 'booked_for',
    'booked_by', 'appointment_status', 'status_if_showed', 'offer_name',
    'campaign_external_id', 'adset_external_id', 'ad_external_id',
    // Stored as amount_spent_cents; the sync converts dollars to cents. Named
    // here as the mapping field, which is what this check is about.
    'amount_spent',
  ]);
  const unknown = TRACKER_COLUMNS.map((c) => c.field).filter((f) => !REAL.has(f));
  check('no field is invented', unknown, []);
}

// ---------------------------------------------------------------------------
console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : ''),
);
process.exit(failures ? 1 : 0);
