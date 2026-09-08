/**
 * Callback requests and appointment confirmations, as they happen.
 *
 * Two Make scenarios already fire on these events and do exactly one thing
 * each — post to the Slack channel watch-shift-alert:
 *
 *   296215  "Call back request"        "CALL WITHIN 5 MINUTES"
 *   296197  "Appointment Confirmation"
 *
 * Neither records anything, so the promise in that message has never been
 * measurable. This endpoint is the record. The scenarios keep posting to Slack
 * unchanged; one additional HTTP module also posts here.
 *
 * Guarded by SERVICE_API_KEY as `Authorization: Bearer <secret>`, matching the
 * consultation-outcome and onboarding-form webhooks. env.ts draws the line
 * between that and CRON_SECRET and says why, so this follows it rather than
 * inventing a third scheme.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not decide whether the request was answered. That is derived from
 * the calls table by v_callcentre_response, because a derived answer cannot go
 * stale — a stored flag would need its own automation and would be wrong the
 * first time that failed.
 *
 * It does not reject an unfamiliar body. These payloads have never been stored
 * before, so nobody knows which of GoHighLevel's forty-odd fields are reliably
 * populated; the whole body is kept and the recognised fields are lifted out
 * of it. A 422 here would drop the first real alert and take the answer with
 * it.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { serverEnv } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/** Which alert fired. Taken from the caller, never guessed from the body. */
const KINDS = ['callback', 'confirmation'] as const;
type Kind = (typeof KINDS)[number];

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * The first present value among several key spellings.
 *
 * GoHighLevel's webhook payload uses snake_case at the top level and camelCase
 * inside nested objects, and the two Make scenarios were built two years apart
 * — so the same fact arrives under different names depending on which
 * workflow fired. Reading several spellings costs nothing and is the
 * difference between a populated column and a null nobody notices.
 */
function pick(body: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const found = asString(body[key]);
    if (found !== null) return found;
  }
  return null;
}

/** An ISO instant, or null. Never "now" as a fallback — see below. */
function asInstant(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function POST(request: NextRequest) {
  let expected: string;
  try {
    expected = serverEnv().SERVICE_API_KEY ?? '';
    if (expected === '') throw new Error('SERVICE_API_KEY is not set.');
  } catch (error) {
    /*
     * 503 rather than 401. "Nobody has configured this" and "your key is
     * wrong" send whoever is debugging to entirely different places, and Make
     * retries a 503 while treating a 401 as final.
     */
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'SERVICE_API_KEY is not configured, so this endpoint cannot authenticate.',
      },
      { status: 503 },
    );
  }

  const provided = request.headers
    .get('authorization')
    ?.replace(/^Bearer /i, '')
    .trim();

  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Body is not JSON.' }, { status: 422 });
  }

  /*
   * The kind comes from the query string, because the two payloads are almost
   * identical and 296197's own Slack text still reads "requested a call back"
   * — copied from 296215 and never corrected. Inferring the kind from the body
   * would inherit that mistake and file every confirmation as a callback.
   */
  const requested = request.nextUrl.searchParams.get('kind');
  const kind = (KINDS as readonly string[]).includes(requested ?? '')
    ? (requested as Kind)
    : null;

  if (kind === null) {
    return NextResponse.json(
      {
        error:
          'Add ?kind=callback or ?kind=confirmation to the URL. It is not ' +
          'inferred from the body: the two alerts send nearly the same ' +
          'payload, and one of their Slack messages describes the other.',
      },
      { status: 422 },
    );
  }

  const location =
    typeof body['location'] === 'object' && body['location'] !== null
      ? (body['location'] as Record<string, unknown>)
      : {};

  const calendar =
    typeof body['calendar'] === 'object' && body['calendar'] !== null
      ? (body['calendar'] as Record<string, unknown>)
      : {};

  const locationCrmId = asString(location['id']);

  /*
   * The practice, resolved here rather than left null.
   *
   * crm_location_id is how every other feed joins a sub-account to a client,
   * so a request from a known practice arrives already attached. Unresolved is
   * kept rather than rejected — an alert from a sub-account the Hub has not
   * seen is still a patient waiting for a call.
   */
  const db = serviceClient();
  let clientId: string | null = null;

  if (locationCrmId !== null) {
    const match = await db
      .from('clients')
      .select('id')
      .eq('crm_location_id', locationCrmId)
      .maybeSingle();
    if (!match.error) clientId = match.data?.id ?? null;
  }

  /*
   * requested_at defaults to now, and that is right rather than lazy: the
   * request happened when the alert fired, and the payload's own date_created
   * is when the CONTACT was created — often weeks earlier. Using that would
   * report every callback as answered instantly or never, depending on which
   * way the arithmetic fell.
   */
  const row = {
    kind,
    crm_contact_id: pick(body, 'contact_id', 'contactId', 'id'),
    /*
     * Built in two steps, because mixing ?? and || without parentheses is a
     * SyntaxError — the same trap ghl.ts records hitting on contact names.
     */
    lead_name: (() => {
      const whole = pick(body, 'full_name', 'fullName', 'name');
      if (whole !== null) return whole;
      const parts = [
        pick(body, 'first_name', 'firstName'),
        pick(body, 'last_name', 'lastName'),
      ].filter((part): part is string => part !== null);
      return parts.length > 0 ? parts.join(' ') : null;
    })(),
    lead_phone: pick(body, 'phone', 'phone_number', 'phoneNumber'),
    location_crm_id: locationCrmId,
    location_name: asString(location['name']),
    client_id: clientId,
    callback_due_at:
      asInstant(calendar['startTime']) ?? asInstant(body['Date Scheduled']),
    sop_link: pick(body, 'SOP Link', 'sop_link'),
    payload: body as never,
    // Make sends its execution id in a header when configured to; when it does
    // not, a null delivery id simply means a retry inserts a second row rather
    // than updating the first, which is visible and preferable to guessing a
    // key from the body.
    delivery_id:
      request.headers.get('x-make-execution-id') ??
      request.headers.get('x-delivery-id'),
  };

  const written = await db
    .from('callcentre_requests')
    .upsert(row as never, { onConflict: 'delivery_id' })
    .select('id')
    .maybeSingle();

  if (written.error) {
    /*
     * A duplicate delivery is a success, not a failure. Make retries on any
     * non-2xx, so answering 500 to "I already have this" would have it retry
     * forever.
     */
    if (written.error.message.includes('duplicate key')) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    console.error('[callcentre] could not record a request:', written.error.message);
    return NextResponse.json(
      { error: 'Could not record the request.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: written.data?.id ?? null,
    kind,
    // Echoed so a Make test run shows whether the practice was recognised
    // without anybody opening the database.
    practiceRecognised: clientId !== null,
  });
}
