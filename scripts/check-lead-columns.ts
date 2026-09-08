/**
 * Exercise the leads tab's tab-finding and header mapping.
 *
 * Both are guesses until the sheet is read once. tracker_leads has never been
 * synced, so LEAD_COLUMNS is written from the shape of the table rather than
 * from the spreadsheet — exactly the position the appointments import was in
 * when it demanded a column called "booked for" from a tab that says "Date
 * Booked", and failed twice.
 *
 * These pin the properties that keep that failure loud rather than silent: the
 * tab is chosen by a rule that cannot pick the appointments tab, no spelling
 * means two fields, and a missing required column stops the run.
 *
 *   npm run check:leads
 *
 * No database, no network, no sheet.
 */
import {
  LEADS_TAB_CANDIDATES,
  LEAD_COLUMNS,
  LEAD_HEADER_TO_FIELD,
  LEAD_REQUIRED_FIELDS,
  looksLikeLeadsTab,
  normaliseLeadHeader,
} from '../src/config/fulfilment-leads';
import { findHeaderRow } from '../src/lib/sheet-headers';

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
section('Finding the leads tab among seventeen');
{
  check('"Lead Data"', looksLikeLeadsTab('Lead Data'), true);
  check('"Leads"', looksLikeLeadsTab('Leads'), true);
  check('lowercase', looksLikeLeadsTab('leads'), true);
  check('padded', looksLikeLeadsTab('  Lead Data  '), true);
  // The tab title people actually write when they do not want it touched.
  check('"LEAD DATA (do not edit)"', looksLikeLeadsTab('LEAD DATA (do not edit)'), true);

  /*
   * The one it must never pick. "Appointment Data" holds consultations, is
   * already imported by fulfilment-tracker, and writing it into tracker_leads
   * would report every consultation as a lead — inflating the denominator of
   * every CPL on the page.
   */
  check('NOT "Appointment Data"', looksLikeLeadsTab('Appointment Data'), false);
  check(
    'NOT a tab that says both',
    looksLikeLeadsTab('Appointment Leads Summary'),
    false,
  );

  check('not "STATS DASHBOARD"', looksLikeLeadsTab('STATS DASHBOARD'), false);
  check('not "INPUT CLIENT INFO"', looksLikeLeadsTab('INPUT CLIENT INFO'), false);
  check('not a blank title', looksLikeLeadsTab('   '), false);

  // Candidates are tried in order, so the deliberate name beats a coincidence.
  check('"Lead Data" is tried first', LEADS_TAB_CANDIDATES[0], 'Lead Data');
  check(
    'every candidate would also pass the loose rule',
    LEADS_TAB_CANDIDATES.filter((tab) => !looksLikeLeadsTab(tab)),
    [],
  );
}

section('Headers match however they are typed');
{
  const lookup = (header: string) =>
    LEAD_HEADER_TO_FIELD.get(normaliseLeadHeader(header));

  check('exact', lookup('Company Name'), 'company_name');
  check('shouted', lookup('COMPANY NAME'), 'company_name');
  check('padded', lookup('  Company Name  '), 'company_name');
  check('a doubled inner space', lookup('Company  Name'), 'company_name');
  check('an unknown header maps to nothing', lookup('Notes For Later'), undefined);

  /*
   * The practice column is company_name here and location_name on
   * tracker_appointments — the same thing under two names, so both spellings
   * reach it. Worth pinning: a reader who assumes the tables share a column
   * name is wrong, and this is where that shows up.
   */
  check('"Location Name" also reaches it', lookup('Location Name'), 'company_name');
  check('"Practice" too', lookup('Practice'), 'company_name');
}

section('The two columns without which a lead is unusable');
{
  /*
   * A lead with no practice belongs to nobody; a lead with no date lands in no
   * reporting window. Either absence makes the row unusable, so the sync stops
   * rather than writing a thousand of them over the 22 August snapshot.
   */
  check('exactly two required', LEAD_REQUIRED_FIELDS.length, 2);
  check('the practice', LEAD_REQUIRED_FIELDS.includes('company_name'), true);
  check('the date', LEAD_REQUIRED_FIELDS.includes('received_on'), true);
  check('the name is not required', LEAD_REQUIRED_FIELDS.includes('lead_name'), false);
  // Blank means one lead, so this must not be required — see asCount.
  check('the count is not required', LEAD_REQUIRED_FIELDS.includes('lead_count'), false);
}

section('No spelling means two different things');
{
  const spellings = LEAD_COLUMNS.flatMap((column) => column.headers);
  const distinct = new Set(spellings.map(normaliseLeadHeader));
  check('every spelling is unique once normalised', distinct.size, spellings.length);
  check('the map holds all of them', LEAD_HEADER_TO_FIELD.size, distinct.size);

  /*
   * The pairs most likely to be conflated by a later edit. "Campaign" is the
   * name and "Campaign ID" the id, and swapping them would file a readable
   * name into a column that joins on ids — a join that then matches nothing
   * while looking populated.
   */
  check('"Campaign" is the name', LEAD_HEADER_TO_FIELD.get('campaign'), 'campaign_name');
  check('"Campaign ID" is the id', LEAD_HEADER_TO_FIELD.get('campaign id'), 'campaign_external_id');
  check('"Ad" is the name', LEAD_HEADER_TO_FIELD.get('ad'), 'ad_name');
  check('"Ad ID" is the id', LEAD_HEADER_TO_FIELD.get('ad id'), 'ad_external_id');
}

section('Every mapped field is a real tracker_leads column');
{
  /*
   * A field named here that does not exist on the table would be sent in the
   * upsert and rejected by Postgres for the whole batch, so one typo loses
   * every row. Taken from migration 0001.
   */
  const REAL = new Set([
    'company_name', 'received_on', 'lead_name', 'lead_count',
    'campaign_external_id', 'campaign_name',
    'adset_external_id', 'adset_name',
    'ad_external_id', 'ad_name',
  ]);
  const unknown = LEAD_COLUMNS.map((c) => c.field).filter((f) => !REAL.has(f));
  check('no field is invented', unknown, []);

  // client_id is deliberately absent: tracker_practice_aliases owns the
  // practice match, and a second copy of that rule would diverge from it.
  check('client_id is not mapped from the sheet', REAL.has('client_id'), false);
}

section('The header row is found, not assumed');
{
  const recognises = (cell: string) =>
    LEAD_HEADER_TO_FIELD.has(normaliseLeadHeader(cell));

  // The shape this workbook actually uses: a merged banner, then the headings.
  const banner = [
    ['LEAD DATA'],
    [],
    ['Company Name', 'Date', 'Name', 'Leads'],
    ['Bright Smile', '8/1/2026', 'A Patient', '1'],
  ];
  check('a banner is skipped', findHeaderRow(banner, recognises).sheetRow, 3);

  const plain = [
    ['Company Name', 'Date'],
    ['Bright Smile', '8/1/2026'],
  ];
  check('a header on row 1 is left alone', findHeaderRow(plain, recognises).sheetRow, 1);
}

// ---------------------------------------------------------------------------
console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : ''),
);
process.exit(failures ? 1 : 0);
