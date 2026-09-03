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
  REQUIRED_FIELDS,
  TRACKER_COLUMNS,
  normaliseHeader,
} from '../src/config/fulfilment-tracker';

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

section('The columns the bonus depends on');
{
  // Without booked_by there is no per-agent attribution, and the ISR bonus —
  // 5 appointments a day pays $10, 6 pays $20, 8 pays $30 — cannot be
  // calculated at all. Several spellings, because nobody has confirmed which
  // the sheet uses.
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
