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
 * Guarded by CRON_SECRET as `Authorization: Bearer <secret>`, matching the
 * recordings webhook. Make can set a header, so there is no query-string
 * fallback here — it would put the secret in access logs for no benefit.
 *
 * Two things it will not do.
 *
 * It will not guess which appointment is meant. Resolution is by GoHighLevel
 * appointment id, and nothing else. Matching on a patient name and a date is
 * what the stat-sheet import does, and the reconciliation page exists because
 * that matching is unreliable — a spelling difference silently becomes a
 * second appointment. No id, 422.
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
 *
 * The appointment-update form (PPS type 04) carries no appointment id at all —
 * it is a form filled in about a patient, not an event on a calendar. Those
 * resolve by GoHighLevel contact id, which is still an id and not a name-and-date
 * guess. See resolveByContact below for which of a contact's appointments wins.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { serverEnv } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';
import type { Database, TablesUpdate } from '@/types/database';

export const dynamic = 'force-dynamic';

type Outcome = Database['public']['Enums']['appointment_outcome'];

/** Outcomes the appointment_outcome enum accepts. */
const OUTCOMES: readonly Outcome[] = [
  'pending',
  'quoted',
  'won',
  'lost',
  'follow_up',
  'unqualified',
];

/**
 * What the GoHighLevel forms actually send for a yes/no question, mapped once.
 *
 * The forms are not consistent — some send "Yes", some "TRUE", the CCM
 * trackers send "Showed" and "No Show" — so the mapping is deliberately
 * generous on input and strict on output. Anything unrecognised returns
 * undefined and the field is left untouched, which is the whole point: an
 * unmapped spelling must not become a false.
 */
function readTri(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '') return undefined;
  if (['yes', 'y', 'true', '1', 'showed', 'show', 'attended', 'complete'].includes(text)) {
    return true;
  }
  if (['no', 'n', 'false', '0', 'no show', 'no-show', 'noshow', 'missed', 'dna'].includes(text)) {
    return false;
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Money in minor units, or undefined.
 *
 * Undefined and zero are different answers. Zero means treatment started and
 * nothing was charged; undefined means nobody said. Collapsing them would put
 * free treatments into the won column at zero value and quietly drag the
 * average case value down.
 */
function readCents(value: unknown): number | undefined {
  const text = asString(value);
  if (text === null) return undefined;
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (cleaned === '') return undefined;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed * 100);
}

/**
 * Read a field under any of several names.
 *
 * The five PPS form types label the same question differently — "Did they show
 * for their appointment?", "Request Type", plain "showed" — and a consolidated
 * endpoint that demanded one spelling would need a Make module per form to
 * rename things. Accepting the known aliases keeps the Make side to a single
 * pass-through.
 */
function pick(body: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (name in body && body[name] !== null && body[name] !== '') {
      return body[name];
    }
  }
  return undefined;
}

/**
 * The `calendar` object out of a GoHighLevel webhook, or an empty one.
 *
 * GoHighLevel nests the appointment id and calendar name under `calendar`.
 * Reading that nesting here means a Make scenario can forward the trigger body
 * unchanged, with no mapping step — and a mapping step per form is exactly the
 * per-client work that made 57 copies of each scenario necessary.
 */
function calendarOf(body: Record<string, unknown>): Record<string, unknown> {
  const raw = body['calendar'];
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export async function POST(request: NextRequest) {
  const env = serverEnv();

  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not set, so this endpoint cannot authenticate.' },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization');
  if (header !== `Bearer ${env.CRON_SECRET}`) {
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

  const calendar = calendarOf(body);

  const appointmentId =
    asString(
      pick(body, [
        'appointment_id',
        'appointmentId',
        'crm_appointment_id',
        'calendar_appointmentId',
      ]),
    ) ?? asString(pick(calendar, ['appointmentId', 'id']));

  /*
   * The update form has no appointment id — it is filled in about a patient
   * rather than raised against a calendar event. A contact id is still an id,
   * so this does not reopen the name-and-date matching the endpoint refuses.
   */
  const contactId = asString(
    pick(body, ['contact_id', 'contactId', 'crm_contact_id']),
  );

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

  const COLUMNS =
    'id, patient_name, client_id, outcome, scheduled_at, status, crm_appointment_id';

  /**
   * Which of a contact's appointments an update form is about.
   *
   * The most recent one that has already happened. A contact who has been
   * rebooked has a future appointment too, and ordering by date alone would
   * hand the form's answers to a consultation that has not occurred yet — so a
   * patient who attended in March and is booked again in May would have March's
   * outcome written against May.
   *
   * The stat sheets have this bug: they match on phone, sort by appointment date
   * descending and take the first. It is invisible there because the sheet holds
   * one row per patient, so both bookings are the same row.
   *
   * If the contact has no past appointment, their earliest upcoming one is used
   * — a form arriving before the sync has caught up is far more likely to be
   * about that booking than about nothing.
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
   * answers onto a different appointment of the same patient would be worse
   * than saying so.
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
     * 404 rather than creating the appointment. The Hub learns appointments
     * from the crm-appointments sync; inventing one here from a form payload
     * would create a second source of truth for whether an appointment exists,
     * and the reconciliation work exists precisely to remove one of those.
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

  const showed = readTri(
    pick(body, [
      'showed',
      'Did they show for their appointment?',
      'show_status',
      'attendance',
    ]),
  );
  const secondShowed = readTri(
    pick(body, [
      'second_consult_showed',
      'Did this patient require a second consultation?',
    ]),
  );
  const ccOnFile = readTri(pick(body, ['cc_on_file', 'CC On File', 'card_on_file']));
  const financing = readTri(
    pick(body, ['financing_approved', 'Approved for Credit Plan?']),
  );
  const valueCents = readCents(
    pick(body, [
      'value',
      'value_cents',
      'treatment_value',
      'If they did start treatment, how much was their total treatment value?',
    ]),
  );

  const rawOutcome = asString(
    pick(body, ['outcome', 'Did they start treatment?', 'result']),
  );
  let outcome: Outcome | undefined;
  if (rawOutcome !== null) {
    const lower = rawOutcome.toLowerCase();
    if ((OUTCOMES as readonly string[]).includes(lower)) outcome = lower as Outcome;
    else if (readTri(rawOutcome) === true) outcome = 'won';
    else if (readTri(rawOutcome) === false) outcome = 'lost';
  }

  const notes = asString(
    pick(body, [
      'notes',
      'If they did not start treatment, what was the reason?',
      'feedback',
    ]),
  );

  /**
   * Cancelled, which is a different fact from not showing up.
   *
   * Both spellings of GoHighLevel's own field are accepted, including its
   * misspelling — the payload really does carry `appoinmentStatus`, and
   * matching only the correct spelling would silently drop every cancellation.
   */
  const statusText = (
    asString(pick(body, ['status', 'appointment_status', 'cancellation_status'])) ??
    asString(
      pick(calendar, ['appoinmentStatus', 'appointmentStatus', 'status']),
    ) ??
    ''
  ).toLowerCase();

  const cancelled =
    readTri(pick(body, ['cancelled', 'is_cancelled', 'appointment_cancelled'])) ===
      true ||
    statusText === 'cancelled' ||
    statusText === 'canceled';

  const update: TablesUpdate<'appointments'> = {
    outcome_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (cancelled) {
    update['status'] = 'cancelled';
    update['cancelled_at'] = new Date().toISOString();
  }
  /*
   * A cancellation wins over an attendance answer in the same payload. A
   * cancelled appointment that also carried "showed: no" would otherwise be
   * recorded as a no-show, and the two are billed and read differently.
   */
  if (showed !== undefined && !cancelled) {
    update['showed'] = showed;
    update['showed_source'] = 'call_centre';
  }
  if (secondShowed !== undefined) update['second_consult_showed'] = secondShowed;
  if (ccOnFile !== undefined) update['cc_on_file'] = ccOnFile;
  if (financing !== undefined) update['financing_approved'] = financing;
  if (valueCents !== undefined) update['value_cents'] = valueCents;
  if (outcome !== undefined) update['outcome'] = outcome;
  if (notes !== null) update['notes'] = notes;

  /*
   * Only the two timestamps means the payload carried nothing readable. Answered
   * as 422 rather than 200 so a form whose field names have drifted says so on
   * the first submission instead of appearing to work for a month.
   */
  if (Object.keys(update).length === 2) {
    return NextResponse.json(
      {
        error:
          'Nothing recognisable to record. The appointment was found but no ' +
          'known field was present, so nothing was written.',
        appointmentId,
        received: Object.keys(body).slice(0, 40),
      },
      { status: 422 },
    );
  }

  const written = await db
    .from('appointments')
    .update(update)
    .eq('id', found.data.id);

  if (written.error) {
    return NextResponse.json({ error: written.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    appointmentId: appointmentId ?? found.data.crm_appointment_id ?? null,
    resolvedBy: appointmentId ? 'appointment id' : 'contact id',
    patient: found.data.patient_name,
    recorded: Object.keys(update).filter(
      (key) => key !== 'updated_at' && key !== 'outcome_updated_at',
    ),
  });
}
