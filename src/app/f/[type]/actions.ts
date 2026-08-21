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
 * The spec says these answers are also upserted into the CRM. That is not done
 * here: it would mean writing to a practice's CRM record on the word of an
 * unauthenticated form, and nothing yet decides which contact to write to. The
 * answers land on /forms for a person to act on, which is honest about where
 * the boundary currently is.
 */
import { findPublicForm } from '@/config/public-forms';
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

  const written = await serviceClient().from('form_submissions').insert({
    form_key: definition.key,
    client_group_id: groupId,
    payload,
  });

  if (written.error) {
    return { ok: false, message: 'Could not send that. Please try again.' };
  }

  await notifyStaff(definition.title, payload, groupId);

  return { ok: true, message: definition.thanks };
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

  const admins = await db.from('user_profiles').select('id').eq('role', 'admin');
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
