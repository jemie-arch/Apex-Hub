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

  const appointmentId = asString(
    pick(body, [
      'appointment_id',
      'appointmentId',
      'crm_appointment_id',
      'calendar_appointmentId',
    ]),
  );

  if (!appointmentId) {
    /*
     * 422 and a named reason rather than a silent 200. A webhook that accepts
     * everything and records nothing is indistinguishable from one that works,
     * which is how the tracker feed went quiet without anybody noticing.
     */
    return NextResponse.json(
      {
        error:
          'No appointment id. Send the GoHighLevel appointment id as ' +
          'appointment_id. Resolution by patient name and date is deliberately ' +
          'not supported — it is unreliable, and it is why reconciliation exists.',
        received: Object.keys(body).slice(0, 40),
      },
      { status: 422 },
    );
  }

  const db = serviceClient();

  const found = await db
    .from('appointments')
    .select('id, patient_name, client_id, outcome')
    .eq('crm_appointment_id', appointmentId)
    .maybeSingle();

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
        error:
          'No appointment in the Hub with that GoHighLevel id. It may not have ' +
          'synced yet — the crm-appointments sync runs nightly. Nothing was ' +
          'created, because appointments are learned from the CRM rather than ' +
          'from a form.',
        appointmentId,
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

  const update: TablesUpdate<'appointments'> = {
    outcome_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (showed !== undefined) {
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
    appointmentId,
    patient: found.data.patient_name,
    recorded: Object.keys(update).filter(
      (key) => key !== 'updated_at' && key !== 'outcome_updated_at',
    ),
  });
}
