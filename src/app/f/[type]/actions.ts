'use server';

/**
 * Public form submissions.
 *
 * Unauthenticated by necessity — a practice fills these in before it has any
 * access to anything. That shapes what this action will do:
 *
 *   - it only ever INSERTS into form_submissions, so the worst a bad actor can
 *     achieve is noise on the Forms page, not a changed practice record;
 *   - it accepts only the field names the form defines, so a crafted POST
 *     cannot smuggle extra keys into the payload;
 *   - attribution comes from a portal token when the link carried one, never
 *     from a client_group_id in the form body, which anyone could invent.
 *
 * The onboarding form is the one exception to "insert and stop": it also builds
 * the practice's GoHighLevel sub-account. That is a write, on the word of an
 * unauthenticated form, so it is worth being precise about why it is acceptable
 * here. It creates a NEW sub-account from a snapshot and touches nothing
 * existing — the worst a crafted POST achieves is an empty sub-account somebody
 * deletes, not a change to a practice already trading. Every other form still
 * only lands on /forms for a person to act on.
 */
import { findPublicForm } from '@/config/public-forms';
import { provisionFromSubmission } from '@/lib/onboarding/provision';
import { resolvePortal } from '@/lib/portal';
import { serviceClient } from '@/lib/supabase/service';

export interface FormResult {
  ok: boolean;
  message: string;
}

/** Keeps one answer from being a novel. */
const MAX_FIELD_LENGTH = 4000;

export async function submitPublicForm(
  slug: string,
  token: string | null,
  formData: FormData,
): Promise<FormResult> {
  const definition = findPublicForm(slug);
  if (!definition) return { ok: false, message: 'That form does not exist.' };

  const allowed = new Map(
    definition.sections
      .flatMap((section) => section.fields)
      .map((field) => [field.name, field]),
  );

  const payload: Record<string, string> = {};
  for (const [name, field] of allowed) {
    const raw = formData.get(name);
    const value = typeof raw === 'string' ? raw.trim() : '';

    if (value === '') {
      if (field.required) {
        return { ok: false, message: `${field.label} is needed.` };
      }
      continue;
    }

    payload[name] = value.slice(0, MAX_FIELD_LENGTH);
  }

  if (Object.keys(payload).length === 0) {
    return { ok: false, message: 'Fill something in first.' };
  }

  // Attribution, if the link carried a portal token. An unrecognised token is
  // not an error — the submission is still worth keeping, just unmatched.
  let groupId: string | null = null;
  if (token) {
    const portal = await resolvePortal(token);
    groupId = portal?.group.id ?? null;
  }

  const written = await serviceClient()
    .from('form_submissions')
    .insert({
      form_key: definition.key,
      client_group_id: groupId,
      payload,
      clinic_name: payload['clinic_name'] ?? payload['practice_name'] ?? null,
      person_name: payload['doctor_name'] ?? payload['contact_name'] ?? null,
      contact_email: payload['doctor_email'] ?? payload['email'] ?? null,
    })
    .select('id')
    .maybeSingle();

  if (written.error) {
    return { ok: false, message: 'Could not send that. Please try again.' };
  }

  await notifyStaff(definition.title, payload, groupId);

  /*
   * Building the sub-account.
   *
   * Deliberately after the insert and deliberately unable to change the answer
   * the sender sees. The submission is saved; if GoHighLevel refuses, that is
   * ours to retry from the Onboarding page and not the practice's problem to
   * hear about. Telling somebody their form failed when we have their answers
   * would just get us the same answers twice.
   */
  if (definition.key === 'client_onboarding') {
    void provisionInBackground({
      submissionId: written.data?.id ?? null,
      clientGroupId: groupId,
      clinicName: payload['clinic_name'] ?? '',
      answers: payload,
    });
  }

  return { ok: true, message: definition.thanks };
}

/**
 * Kicks off provisioning without making the sender wait for GoHighLevel.
 *
 * Every outcome is written to provisioning_runs, so nothing depends on this
 * promise being observed — which is the point, since the response has already
 * gone back by the time it settles.
 */
async function provisionInBackground(input: {
  submissionId: string | null;
  clientGroupId: string | null;
  clinicName: string;
  answers: Record<string, string>;
}): Promise<void> {
  try {
    await provisionFromSubmission(input);
  } catch {
    // provisionFromSubmission records its own failures. Anything escaping it is
    // already on the row; swallowing here only stops an unhandled rejection.
  }
}

/**
 * Tells the staff. Best-effort: the submission is already saved, so a failure
 * to notify must not read to the sender as a failure to send.
 */
async function notifyStaff(
  formTitle: string,
  payload: Record<string, string>,
  groupId: string | null,
): Promise<void> {
  const db = serviceClient();

  const admins = await db
    .from('user_profiles')
    .select('id')
    .in('role', ['admin', 'super_admin']);
  if (admins.error || !admins.data || admins.data.length === 0) return;

  const who =
    payload['practice_name'] ?? payload['contact_name'] ?? 'someone unmatched';

  await db.from('notifications').insert(
    admins.data.map((admin) => ({
      user_id: admin.id,
      kind: 'info' as const,
      title: `${formTitle} — ${who}`,
      body: groupId === null ? 'Not matched to a client yet.' : null,
      href: '/forms',
    })),
  );
}
