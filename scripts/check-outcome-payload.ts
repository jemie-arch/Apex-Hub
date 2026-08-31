/**
 * Exercise the consultation-outcome payload reader against real payload shapes.
 *
 * Written because the cancellation and contact-id paths shipped without ever
 * having been run: they sit behind CRON_SECRET, so they cannot be poked from
 * outside, and a type check proves the shapes line up rather than that the
 * decisions are right.
 *
 * The payloads below are trimmed from actual GoHighLevel bodies found in Make
 * blueprints — including the misspelling in "appoinmentStatus", which is theirs
 * and not a typo here. No patient data: names, emails and phone numbers are
 * invented, and nothing identifying was copied out of a stored sample.
 *
 *   npm run check:webhook
 *
 * No database, no network, no secret. Exits non-zero on the first failure.
 */
import { readConsultationPayload } from '../src/lib/webhooks/consultation-payload';

let failures = 0;
let checks = 0;

function check(what: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  ok    ${what}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${what}`);
  console.log(`        expected ${b}`);
  console.log(`        actual   ${a}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
section('Type 06 — a cancellation, as the consolidated scenario sends it');
{
  const read = readConsultationPayload({
    appointment_id: 'QDTjBQ6VjRX0lap8sl27',
    cancelled: 'yes',
  });
  check('resolves by appointment id', read.appointmentId, 'QDTjBQ6VjRX0lap8sl27');
  check('is a cancellation', read.cancelled, true);
  check('sets the status', read.changes.status, 'cancelled');
  check('does not touch showed', 'showed' in read.changes, false);
  check('does not invent a showed_source', 'showed_source' in read.changes, false);
}

section('Type 06 — a raw GoHighLevel body, nesting and misspelling intact');
{
  const read = readConsultationPayload({
    contact_id: 'contact-abc',
    calendar: {
      id: 'cal-1',
      appointmentId: 'appt-from-nesting',
      calendarName: ' Some Practice Booking Calendar ',
      appoinmentStatus: 'cancelled', // GoHighLevel's own spelling
    },
  });
  check('reads the nested appointment id', read.appointmentId, 'appt-from-nesting');
  check(
    'prefers the appointment id over the contact id',
    read.appointmentId !== null,
    true,
  );
  check('catches the misspelled status', read.cancelled, true);
  check('sets the status', read.changes.status, 'cancelled');
}

section('A cancellation that also claims a no-show');
{
  const read = readConsultationPayload({
    appointment_id: 'appt-2',
    cancelled: true,
    showed: 'no',
  });
  check('cancellation wins', read.changes.status, 'cancelled');
  check('no-show is not recorded', 'showed' in read.changes, false);
}

// ---------------------------------------------------------------------------
section('Type 04 — the appointment update form, which has no appointment id');
{
  const read = readConsultationPayload({
    contact_id: 'bleoU6MlyPhFisCfr32L',
    'Did they start treatment?': 'Yes',
    'If they did start treatment, how much was their total treatment value?': '$4,500.00',
    'If they did not start treatment, what was the reason?': '',
  });
  check('has no appointment id', read.appointmentId, null);
  check('falls back to the contact id', read.contactId, 'bleoU6MlyPhFisCfr32L');
  check('treatment started reads as won', read.changes.outcome, 'won');
  check('money survives currency formatting', read.changes.value_cents, 450000);
  check('a blank reason is not stored', 'notes' in read.changes, false);
  check('nothing is cancelled', read.cancelled, false);
}

section('Type 04 — treatment did not start');
{
  const read = readConsultationPayload({
    contact_id: 'c-2',
    'Did they start treatment?': 'No',
    'If they did not start treatment, what was the reason?': 'Wants to think it over',
  });
  check('reads as lost', read.changes.outcome, 'lost');
  check('keeps the reason', read.changes.notes, 'Wants to think it over');
  check('no value is invented', 'value_cents' in read.changes, false);
}

// ---------------------------------------------------------------------------
section('Silence is never data');
{
  const read = readConsultationPayload({
    appointment_id: 'appt-3',
    showed: '',
    'Did they start treatment?': '',
    cc_on_file: null,
  });
  check('blank attendance writes nothing', 'showed' in read.changes, false);
  check('blank outcome writes nothing', 'outcome' in read.changes, false);
  check('null writes nothing', 'cc_on_file' in read.changes, false);
  check('so there is nothing to record at all', Object.keys(read.changes).length, 0);
}

section('An unmapped spelling must not become a false');
{
  const read = readConsultationPayload({
    appointment_id: 'appt-4',
    showed: 'Rescheduled by patient',
  });
  check('unknown answer is left alone', 'showed' in read.changes, false);
}

// ---------------------------------------------------------------------------
section('Zero is an answer, absent is not');
{
  const zero = readConsultationPayload({ appointment_id: 'a', value: '0' });
  check('zero is recorded', zero.changes.value_cents, 0);

  const absent = readConsultationPayload({ appointment_id: 'a' });
  check('absent is not', 'value_cents' in absent.changes, false);
}

section('Type 02 and 03 — the CCM trackers still read as before');
{
  const showed = readConsultationPayload({
    appointment_id: 'a',
    showed: 'Showed',
  });
  check('"Showed" is true', showed.changes.showed, true);
  check('and is attributed to the call centre', showed.changes.showed_source, 'call_centre');

  const noShow = readConsultationPayload({
    appointment_id: 'a',
    showed: 'No Show',
  });
  check('"No Show" is false', noShow.changes.showed, false);

  const second = readConsultationPayload({
    appointment_id: 'a',
    second_consult_showed: 'no',
  });
  check('second consult is separate', second.changes.second_consult_showed, false);
  check('and does not set the first', 'showed' in second.changes, false);
}

section('Neither id at all');
{
  const read = readConsultationPayload({ showed: 'yes' });
  check('no appointment id', read.appointmentId, null);
  check('no contact id', read.contactId, null);
}

// ---------------------------------------------------------------------------
console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : ''),
);
process.exit(failures ? 1 : 0);
