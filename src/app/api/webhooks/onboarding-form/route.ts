/**
 * Receives an onboarding form submission from GoHighLevel.
 *
 * This is the pipe that was missing. form_submissions holds 143 rows and every
 * one of them was created on 22 August 2026 — a single import, never repeated.
 * Nothing in this app wrote a GoHighLevel submission before this route existed,
 * so the onboarding automation had no live input: the adapter could translate a
 * GoHighLevel payload and the backlog pass could provision it, but no new
 * submission ever arrived to be translated.
 *
 * Guarded by SERVICE_API_KEY as `Authorization: Bearer <secret>`, matching
 * /api/webhooks/consultation-outcome. CRON_SECRET is deliberately not used:
 * env.ts draws that line, and this is a key pasted into Make rather than one the
 * app needs to boot.
 *
 *   POST /api/webhooks/onboarding-form
 *   { "form_key": "client-onboarding",
 *     "submission_id": "<GoHighLevel submission id>",
 *     "answers": { "<question text>": "<answer>", ... } }
 *
 * `answers` may also be sent as the top-level body, with form_key and
 * submission_id alongside it — Make finds a flat pass-through easier to build,
 * and a mapping step per form is the per-client work the consolidation removed.
 *
 * Idempotent on the GoHighLevel submission id. Make retries on any non-2xx, and
 * a retry must not produce a second row or a second sub-account.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { authorisedByServiceKey } from '@/lib/auth/service-key';
import {
  groupAlreadyLive,
  withinAutoProvisionWindow,
} from '@/lib/onboarding/auto-provision';
import {
  adaptGhlOnboarding,
  GHL_ONBOARDING_FORM_KEY,
  HUB_ONBOARDING_FORM_KEY,
} from '@/lib/onboarding/ghl-form';
import { provisionFromSubmission } from '@/lib/onboarding/provision';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/** Form keys this route will accept. Anything else is a 422, not a silent drop. */
const ACCEPTED = new Set<string>([
  GHL_ONBOARDING_FORM_KEY,
  HUB_ONBOARDING_FORM_KEY,
]);

/** Keys that carry routing rather than an answer, so they stay out of payload. */
const ENVELOPE = new Set([
  'form_key',
  'formKey',
  'submission_id',
  'submissionId',
  'answers',
  'is_test',
  'location_id',
  'locationId',
]);

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Which practice this is, without guessing.
 *
 * Email first, because it is the only field a practice cannot spell two ways.
 * Name second, and only an exact match on a trimmed, case-folded name — the
 * `contains` method the Onboarding page can display is deliberately not produced
 * here. A fuzzy match made by a webhook at 3am gets a sub-account built against
 * the wrong practice; the same fuzzy match offered on screen gets looked at
 * first. So an uncertain row lands unmatched, with a suggestion, and the
 * Onboarding page is where a person resolves it.
 */
async function matchGroup(
  db: ReturnType<typeof serviceClient>,
  email: string | null,
  clinicName: string | null,
): Promise<{ groupId: string | null; method: string | null; suggested: string | null }> {
  if (email) {
    const byEmail = await db
      .from('client_groups')
      .select('id')
      .ilike('contact_email', email)
      .limit(2);
    if (byEmail.error) throw byEmail.error;
    if ((byEmail.data ?? []).length === 1) {
      return { groupId: byEmail.data![0]!.id, method: 'exact', suggested: null };
    }
  }

  if (clinicName) {
    const byName = await db
      .from('client_groups')
      .select('id, name')
      .ilike('name', clinicName)
      .limit(2);
    if (byName.error) throw byName.error;
    if ((byName.data ?? []).length === 1) {
      return { groupId: byName.data![0]!.id, method: 'exact', suggested: null };
    }

    // Not matched, but worth offering. Never auto-applied.
    const like = await db
      .from('client_groups')
      .select('id')
      .ilike('name', `%${clinicName}%`)
      .limit(2);
    if (like.error) throw like.error;
    if ((like.data ?? []).length === 1) {
      return { groupId: null, method: 'contains', suggested: like.data![0]!.id };
    }
  }

  return { groupId: null, method: null, suggested: null };
}

export async function POST(request: NextRequest) {
  let allowed: boolean;
  try {
    allowed = authorisedByServiceKey(request);
  } catch (error) {
    // SERVICE_API_KEY missing: say so rather than a bare 401, which would send
    // somebody hunting for a wrong key that is in fact absent.
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
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const formKey = text(body['form_key'] ?? body['formKey']);
  if (!formKey || !ACCEPTED.has(formKey)) {
    return NextResponse.json(
      {
        error: `form_key must be one of: ${[...ACCEPTED].join(', ')}`,
        received: formKey,
      },
      { status: 422 },
    );
  }

  const nested = body['answers'];
  const answers: Record<string, unknown> =
    typeof nested === 'object' && nested !== null && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : Object.fromEntries(
          Object.entries(body).filter(([key]) => !ENVELOPE.has(key)),
        );

  if (Object.keys(answers).length === 0) {
    return NextResponse.json({ error: 'no answers in body' }, { status: 400 });
  }

  const db = serviceClient();
  const crmSubmissionId = text(body['submission_id'] ?? body['submissionId']);

  /*
   * Idempotency, before anything is written.
   *
   * Make retries on a non-2xx, and a duplicate here would mean a second
   * provisioning attempt for the same practice. Rows without a GoHighLevel id
   * cannot be deduplicated this way, so they are accepted as new — that only
   * happens for payloads Make sends without one, which is a configuration
   * choice we would rather see as duplicates than silently drop.
   */
  if (crmSubmissionId) {
    const seen = await db
      .from('form_submissions')
      .select('id')
      .eq('crm_submission_id', crmSubmissionId)
      .limit(1)
      .maybeSingle();
    if (seen.error) {
      return NextResponse.json({ error: seen.error.message }, { status: 500 });
    }
    if (seen.data) {
      return NextResponse.json(
        { ok: true, duplicate: true, submissionId: seen.data.id },
        { status: 200 },
      );
    }
  }

  // Translate first, so the columns below read the same field names whichever
  // form this came from.
  const normalised =
    formKey === GHL_ONBOARDING_FORM_KEY
      ? adaptGhlOnboarding(answers)
      : (answers as Record<string, string>);

  const clinicName = text(normalised['clinic_name']);
  const contactEmail = text(normalised['doctor_email'] ?? normalised['email']);
  const personName = text(normalised['doctor_name']);
  const contactPhone = text(normalised['doctor_phone'] ?? normalised['phone']);

  let match: Awaited<ReturnType<typeof matchGroup>>;
  try {
    match = await matchGroup(db, contactEmail, clinicName);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'match failed' },
      { status: 500 },
    );
  }

  const submittedAt = new Date().toISOString();

  const written = await db
    .from('form_submissions')
    .insert({
      form_key: formKey,
      crm_submission_id: crmSubmissionId,
      client_group_id: match.groupId,
      suggested_group_id: match.suggested,
      match_method: match.method,
      // The raw answers, not the translated ones. The payload is the record of
      // what the practice actually sent, and adapting it on the way in would
      // make a future mapping fix unable to re-read the original.
      payload: answers as never,
      clinic_name: clinicName,
      person_name: personName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      submitted_at: submittedAt,
      is_test: body['is_test'] === true,
      source_location_id: text(body['location_id'] ?? body['locationId']),
    })
    .select('id')
    .maybeSingle();

  if (written.error) {
    return NextResponse.json({ error: written.error.message }, { status: 500 });
  }

  const submissionId = written.data?.id ?? null;

  /*
   * Provision now if it is allowed to happen unattended.
   *
   * Both rails are checked here rather than trusted to the nightly pass, because
   * this route can create a live GoHighLevel account and the nightly pass is a
   * different code path. A submission that fails either rail is still saved and
   * still appears on the Onboarding page for a person to action.
   *
   * A failure to provision is never a failure to receive. The practice's answers
   * are stored either way, and Make must not retry a saved submission just
   * because GoHighLevel had a bad minute.
   */
  let provisioned: string | null = null;

  if (
    !(body['is_test'] === true) &&
    withinAutoProvisionWindow(submittedAt) &&
    clinicName !== null
  ) {
    try {
      if (!(await groupAlreadyLive(db, match.groupId))) {
        const outcome = await provisionFromSubmission({
          submissionId,
          clientGroupId: match.groupId,
          clinicName,
          answers: normalised,
        });
        provisioned = outcome.status;
      } else {
        provisioned = 'skipped_group_already_live';
      }
    } catch {
      // provisionFromSubmission records its own failures on the run row, and the
      // nightly pass retries. Nothing here should turn a stored submission into
      // a retryable error for Make.
      provisioned = 'deferred';
    }
  }

  return NextResponse.json(
    { ok: true, submissionId, matched: match.method, provisioned },
    { status: 200 },
  );
}
