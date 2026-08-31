/**
 * Reading a consultation outcome out of whatever GoHighLevel sent.
 *
 * Split out of the route so it can be exercised without a database, a secret or
 * a running server. An App Router route file may only export its handlers, so
 * "extract it to test it" is not a preference here, it is the only way.
 *
 * Everything in this file is pure: a payload in, the intended column changes
 * out. Nothing here decides *which* appointment is meant — that needs the
 * database and stays in the route.
 */
import type { Database, TablesUpdate } from '@/types/database';

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
 * The forms are not consistent — some send "Yes", some "TRUE", the CCM trackers
 * send "Showed" and "No Show" — so the mapping is deliberately generous on input
 * and strict on output. Anything unrecognised returns undefined and the field is
 * left untouched, which is the whole point: an unmapped spelling must not become
 * a false.
 */
export function readTri(value: unknown): boolean | undefined {
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

export function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Money in minor units, or undefined.
 *
 * Undefined and zero are different answers. Zero means treatment started and
 * nothing was charged; undefined means nobody said. Collapsing them would put
 * free treatments into the won column at zero value and quietly drag the average
 * case value down.
 */
export function readCents(value: unknown): number | undefined {
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
export function pick(body: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (name in body && body[name] !== null && body[name] !== '') {
      return body[name];
    }
  }
  return undefined;
}

/**
 * The calendar object out of a GoHighLevel webhook, or an empty one.
 *
 * GoHighLevel nests the appointment id and calendar name under "calendar".
 * Reading that nesting here means a Make scenario can forward the trigger body
 * unchanged, with no mapping step — and a mapping step per form is exactly the
 * per-client work that made 57 copies of each scenario necessary.
 */
export function calendarOf(body: Record<string, unknown>): Record<string, unknown> {
  const raw = body['calendar'];
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export type ReadPayload = {
  /** The GoHighLevel appointment id, if the payload names one. */
  appointmentId: string | null;
  /** The GoHighLevel contact id, used only when there is no appointment id. */
  contactId: string | null;
  /** Whether this payload is reporting a cancellation. */
  cancelled: boolean;
  /**
   * The columns to write. Carries no timestamps — the route adds those — so an
   * empty object means the payload said nothing this endpoint understands.
   */
  changes: TablesUpdate<'appointments'>;
};

/**
 * Turn a payload into the set of columns it asks to change.
 *
 * Silence is never data. A field that is absent, blank, or spelled in a way the
 * mapping does not know stays out of the result entirely, so the stored value is
 * left as it was. A blank attendance question must not record a no-show, because
 * a no-show is exactly what a practice does not get billed for.
 */
export function readConsultationPayload(
  body: Record<string, unknown>,
): ReadPayload {
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

  const contactId = asString(
    pick(body, ['contact_id', 'contactId', 'crm_contact_id']),
  );

  /*
   * Both spellings of GoHighLevel's own status field are accepted, including its
   * misspelling — the payload really does carry "appoinmentStatus", and matching
   * only the correct spelling would silently drop every cancellation.
   */
  const statusText = (
    asString(pick(body, ['status', 'appointment_status', 'cancellation_status'])) ??
    asString(pick(calendar, ['appoinmentStatus', 'appointmentStatus', 'status'])) ??
    ''
  ).toLowerCase();

  const cancelled =
    readTri(pick(body, ['cancelled', 'is_cancelled', 'appointment_cancelled'])) ===
      true ||
    statusText === 'cancelled' ||
    statusText === 'canceled';

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

  const changes: TablesUpdate<'appointments'> = {};

  if (cancelled) {
    changes['status'] = 'cancelled';
    changes['cancelled_at'] = new Date().toISOString();
  }
  /*
   * A cancellation wins over an attendance answer in the same payload. A
   * cancelled appointment that also carried "showed: no" would otherwise be
   * recorded as a no-show, and the two are billed and read differently.
   */
  if (showed !== undefined && !cancelled) {
    changes['showed'] = showed;
    changes['showed_source'] = 'call_centre';
  }
  if (secondShowed !== undefined) changes['second_consult_showed'] = secondShowed;
  if (ccOnFile !== undefined) changes['cc_on_file'] = ccOnFile;
  if (financing !== undefined) changes['financing_approved'] = financing;
  if (valueCents !== undefined) changes['value_cents'] = valueCents;
  if (outcome !== undefined) changes['outcome'] = outcome;
  if (notes !== null) changes['notes'] = notes;

  return { appointmentId, contactId, cancelled, changes };
}
