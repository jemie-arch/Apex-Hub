/**
 * Inbound consultation outcomes.
 *
 * The call centre records most show and no-show outcomes. Their route today is
 * a GoHighLevel form into Make into a Google stat sheet, which the Hub then
 * imports — five hops, and every fault the scenario audit turned up lives in
 * the middle three: a sheet addressed by a stale display label, a lookup
 * reading a file nothing writes to, a spreadsheet id carrying a trailing
 * newline. This endpoint is the short path: the form posts here and the
 * appointment is updated directly.
 *
 * /b2c gives the same people a screen to type into. This exists for the case
 * where they keep using the GoHighLevel form they already know, so the workflow
 * does not have to change on the same day the storage does.
 *
 * Guarded by SERVICE_API_KEY as `Authorization: Bearer <secret>`, not by
 * CRON_SECRET. env.ts draws that line and says why: SERVICE_API_KEY "is pasted
 * into Make, so it can be rotated without touching the cron schedule."
 *
 * The distinction is the whole point. CRON_SECRET is required for the app to
 * boot and is what the nightly sync authenticates with; it should never leave
 * Vercel. A secret that has been copied into a third-party automation platform
 * needs to be rotatable on an afternoon's notice, and rotating CRON_SECRET
 * means every cron route stops until each consumer is updated.
 *
 * The bearer comparison is constant-time, matching /api/tokens/ghl. A plain
 * !== leaks the position of the first differing character to anyone who can
 * time the response, which is enough to recover a secret one byte at a time.
 *
 * Make can set a header, so there is no query-string fallback — it would put
 * the secret in access logs for no benefit.
 *
 * How a payload becomes a set of column changes lives in
 * lib/webhooks/consultation-payload, which is pure and separately exercised by
 * scripts/check-outcome-payload.ts. What is left here is the part that needs a
 * database: deciding which appointment is meant.
 *
 * Two things it will not do.
 *
 * It will not guess which appointment is meant. Resolution is by GoHighLevel
 * appointment id, or by GoHighLevel contact id for the update form, which
 * carries no appointment id. Both are ids. Matching on a patient name and a date
 * is what the stat-sheet import does, and the reconciliation page exists because
 * that matching is unreliable — a spelling difference silently becomes a second
 * appointment. Neither id, 422.
 *
 * It will not turn silence into data. An absent field is left alone rather than
 * written as false or null. A form submitted with the attendance question blank
 * must not record a no-show, because a no-show is exactly what a practice does
 * not get billed for.
 *
 * It also takes the two other things Make currently writes into stat sheets.
 *
 * A cancellation (PPS type 06) sets the status and nothing else. Cancelled is
 * emphatically not a no-show: the stat sheets write a literal "C" into the show
 * column precisely to keep them apart, and a practice is not billed for either,
 * but they mean different things about the patient. So `showed` is left
 * untouched on a cancellation rather than set false.
 *
 * The cloned type-06 scenarios branch on the calendar name to decide whether to
 * mark the first or the second consultation cancelled. That branch is not
 * reproduced here, and its absence is the point: a stat sheet holds one row per
 * patient, so both consultations share a row and have to be told apart by hand.
 * The Hub holds one row per appointment. The appointment id already says which
 * consultation was cancelled, so there is nothing to decide.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { serviceApiKey } from '@/lib/env';
import { applyPrecedence } from '@/lib/outcomes/precedence';
import { serviceClient } from '@/lib/supabase/service';
import { readConsultationPayload } from '@/lib/webhooks/consultation-payload';

export const dynamic = 'force-dynamic';

/** Constant-time bearer check, the same shape as /api/tokens/ghl. */
function authorised(request: NextRequest): boolean {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;

  const provided = header.slice('Bearer '.length);
  const expected = serviceApiKey();

  if (provided.length !== expected.length) return false;

  let mismatch = 0;
  for (let index = 0; index < provided.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function POST(request: NextRequest) {
  let allowed: boolean;
  try {
    allowed = authorised(request);
  } catch (error) {
    // SERVICE_API_KEY missing: say so rather than returning a bare 401, which
    // would look like a wrong key and send somebody hunting the wrong problem.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'not configured' },
      { status: 503 },
    );
  }

  if (!allowed) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    const raw = await request.json();
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return NextResponse.json(
        { error: 'Body must be a JSON object.' },
        { status: 422 },
      );
    }
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Body is not JSON.' }, { status: 422 });
  }

  const { appointmentId, contactId, changes } = readConsultationPayload(body);

  if (!appointmentId && !contactId) {
    /*
     * 422 and a named reason rather than a silent 200. A webhook that accepts
     * everything and records nothing is indistinguishable from one that works,
     * which is how the tracker feed went quiet without anybody noticing.
     */
    return NextResponse.json(
      {
        error:
          'No appointment id and no contact id. Send the GoHighLevel ' +
          'appointment id as appointment_id, or — for the appointment update ' +
          'form, which has no appointment id — the contact id as contact_id. ' +
          'Resolution by patient name and date is deliberately not supported: ' +
          'it is unreliable, and it is why reconciliation exists.',
        received: Object.keys(body).slice(0, 40),
      },
      { status: 422 },
    );
  }

  const db = serviceClient();

  /*
   * The provenance and answer columns are selected too. What this request is
   * allowed to write depends on whether the practice has already answered — see
   * lib/outcomes/precedence.
   */
  const COLUMNS =
    'id, patient_name, client_id, outcome, scheduled_at, status, crm_appointment_id, showed, second_consult_showed, showed_source, value_cents, financing_approved, cc_on_file, notes, lead_quality, outcome_source';

  /**
   * Which of a contact's appointments an update form is about.
   *
   * The most recent one that has already happened. A contact who has been
   * rebooked has a future appointment too, and ordering by date alone would hand
   * the form's answers to a consultation that has not occurred yet — so a patient
   * who attended in March and is booked again in May would have March's outcome
   * written against May.
   *
   * The stat sheets have this bug: they match on phone, sort by appointment date
   * descending and take the first. It is invisible there because the sheet holds
   * one row per patient, so both bookings are the same row.
   *
   * If the contact has no past appointment, their earliest upcoming one is used —
   * a form arriving before the sync has caught up is far more likely to be about
   * that booking than about nothing.
   */
  async function resolveByContact(id: string) {
    const past = await db
      .from('appointments')
      .select(COLUMNS)
      .eq('crm_contact_id', id)
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (past.error || past.data) return past;

    return db
      .from('appointments')
      .select(COLUMNS)
      .eq('crm_contact_id', id)
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();
  }

  /*
   * An appointment id that matches nothing is not a reason to go looking by
   * contact. It means that appointment has not synced, and quietly writing the
   * answers onto a different appointment of the same patient would be worse than
   * saying so.
   */
  const found = appointmentId
    ? await db
        .from('appointments')
        .select(COLUMNS)
        .eq('crm_appointment_id', appointmentId)
        .maybeSingle()
    : await resolveByContact(contactId as string);

  if (found.error) {
    return NextResponse.json({ error: found.error.message }, { status: 500 });
  }

  if (!found.data) {
    /*
     * 404 rather than creating the appointment. The Hub learns appointments from
     * the crm-appointments sync; inventing one here from a form payload would
     * create a second source of truth for whether an appointment exists, and the
     * reconciliation work exists precisely to remove one of those.
     */
    return NextResponse.json(
      {
        error: appointmentId
          ? 'No appointment in the Hub with that GoHighLevel appointment id. It ' +
            'may not have synced yet — the crm-appointments sync runs nightly. ' +
            'Nothing was created, because appointments are learned from the CRM ' +
            'rather than from a form.'
          : 'No appointment in the Hub for that GoHighLevel contact id. Either ' +
            'the contact has never had one synced, or this practice is losing ' +
            'appointments upstream — worth checking calendar_list_conflicts and ' +
            'the missing-calendar alert before assuming the form is at fault.',
        appointmentId,
        contactId,
      },
      { status: 404 },
    );
  }

  /*
   * Nothing to write means the payload carried nothing readable. Answered as 422
   * rather than 200 so a form whose field names have drifted says so on the first
   * submission instead of appearing to work for a month.
   */
  if (Object.keys(changes).length === 0) {
    return NextResponse.json(
      {
        error:
          'Nothing recognisable to record. The appointment was found but no ' +
          'known field was present, so nothing was written.',
        appointmentId,
        contactId,
        received: Object.keys(body).slice(0, 40),
      },
      { status: 422 },
    );
  }

  /*
   * This arrives from the GoHighLevel update form, which the call centre fills
   * in — so it writes with call-centre authority, not the practice's. Anything
   * the practice has already answered in their portal is kept, and this fills
   * only what they left blank.
   *
   * Without this the last writer won, which would have made the portal's
   * on-screen promise — "nothing you type here is overwritten by our systems" —
   * false the first time both were used on the same consultation.
   */
  const { changes: permitted, dropped } = applyPrecedence(
    found.data,
    changes,
    'call_centre',
  );

  const now = new Date().toISOString();
  const written = await db
    .from('appointments')
    .update({ ...permitted, outcome_updated_at: now, updated_at: now })
    .eq('id', found.data.id);

  if (written.error) {
    return NextResponse.json({ error: written.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    appointmentId: appointmentId ?? found.data.crm_appointment_id ?? null,
    resolvedBy: appointmentId ? 'appointment id' : 'contact id',
    patient: found.data.patient_name,
    recorded: Object.keys(permitted),
    /*
     * Reported rather than hidden: a form that says "saved" while discarding
     * half the submission is how somebody comes to trust a number that is not
     * theirs. An empty array is the normal case.
     */
    keptFromPractice: dropped,
  });
}
