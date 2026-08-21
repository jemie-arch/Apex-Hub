'use server';

/**
 * The writes a clinic can make from its portal.
 *
 * Every one of these re-resolves the token and proves ownership before writing.
 * A server action is a POST endpoint anybody can call with any id, so the id in
 * the request is never trusted on its own — see requireGroup below.
 *
 * Nothing here can reach another practice: every query is filtered by the group
 * the token resolves to, and a mismatch returns the same message as a bad token
 * so the response never confirms that a record exists elsewhere.
 */
import { revalidatePath } from 'next/cache';

import { resolvePortal, type PortalContext } from '@/lib/portal';
import { serviceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';

type LeadQuality = Database['public']['Enums']['lead_quality'];
type AppointmentOutcome = Database['public']['Enums']['appointment_outcome'];

const OUTCOMES: readonly AppointmentOutcome[] = [
  'pending',
  'quoted',
  'won',
  'lost',
  'follow_up',
  'unqualified',
];

const QUALITIES: readonly LeadQuality[] = ['high', 'medium', 'low', 'unusable'];

export interface PortalResult {
  ok: boolean;
  message: string;
}

const NO_ACCESS: PortalResult = {
  ok: false,
  message: 'This link is no longer active.',
};

async function requireGroup(token: string): Promise<PortalContext | null> {
  if (!token) return null;
  return resolvePortal(token);
}

function clean(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The full consultation outcome — the reason the portal exists. The agency can
 * see that somebody booked and whether they came; only the practice knows
 * whether treatment started and for how much.
 */
export async function saveConsultationOutcome(input: {
  token: string;
  appointmentId: string;
  outcome: string;
  showed: 'yes' | 'no' | 'unknown';
  value: string;
  financing: 'yes' | 'no' | 'unknown';
  leadQuality: string;
  notes: string;
}): Promise<PortalResult> {
  const portal = await requireGroup(input.token);
  if (!portal) return NO_ACCESS;

  if (!OUTCOMES.includes(input.outcome as AppointmentOutcome)) {
    return { ok: false, message: 'That outcome is not recognised.' };
  }
  if (
    input.leadQuality !== '' &&
    !QUALITIES.includes(input.leadQuality as LeadQuality)
  ) {
    return { ok: false, message: 'That lead quality is not recognised.' };
  }

  const db = serviceClient();

  // The ownership proof. Without the client_id filter, any appointment id
  // would be writable from any portal.
  const owned = await db
    .from('appointments')
    .select('id')
    .eq('id', input.appointmentId)
    .in('client_id', portal.locationIds)
    .maybeSingle();

  if (owned.error) return { ok: false, message: 'Could not verify access.' };
  if (!owned.data) {
    return { ok: false, message: 'That appointment could not be found.' };
  }

  let valueCents: number | null = null;
  if (input.value.trim() !== '') {
    const parsed = Number.parseFloat(input.value.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, message: 'Enter a value of zero or more.' };
    }
    valueCents = Math.round(parsed * 100);
  }

  const showed =
    input.showed === 'yes' ? true : input.showed === 'no' ? false : null;
  const financing =
    input.financing === 'yes' ? true : input.financing === 'no' ? false : null;

  const written = await db
    .from('appointments')
    .update({
      outcome: input.outcome as AppointmentOutcome,
      // 'unknown' leaves the stored answer alone rather than clearing it —
      // "we have not asked yet" is not the same as "no".
      //
      // Stamping the source is what stops the next CRM sync overwriting this:
      // the clinic was in the room, so their answer outranks the calendar's.
      ...(showed === null ? {} : { showed, showed_source: 'client' }),
      ...(financing === null ? {} : { financing_approved: financing }),
      ...(valueCents === null ? {} : { value_cents: valueCents }),
      ...(input.leadQuality === ''
        ? {}
        : { lead_quality: input.leadQuality as LeadQuality }),
      ...(input.notes.trim() === '' ? {} : { notes: input.notes.trim() }),
      outcome_updated_at: new Date().toISOString(),
    })
    .eq('id', input.appointmentId);

  if (written.error) {
    return { ok: false, message: 'Could not save that. Try again.' };
  }

  revalidatePath(`/portal/${input.token}`);
  revalidatePath(`/portal/${input.token}/appointments`);
  return { ok: true, message: 'Saved. Thank you — this is the bit we cannot see.' };
}

/** Practice details, maintained by the practice. No sync overwrites these. */
export async function savePracticeDetails(
  token: string,
  formData: FormData,
): Promise<PortalResult> {
  const portal = await requireGroup(token);
  if (!portal) return NO_ACCESS;

  // Free text per day: practices write things like "8–1, 2–5, closed alt
  // Fridays", which no start/end pair can hold.
  const days = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ];
  const hours: Record<string, string> = {};
  for (const day of days) {
    const value = clean(formData.get(`hours_${day}`));
    if (value !== null) hours[day] = value;
  }

  const written = await serviceClient()
    .from('client_groups')
    .update({
      contact_name: clean(formData.get('contact_name')),
      contact_email: clean(formData.get('contact_email')),
      contact_phone: clean(formData.get('contact_phone')),
      website: clean(formData.get('website')),
      address_line1: clean(formData.get('address_line1')),
      address_line2: clean(formData.get('address_line2')),
      city: clean(formData.get('city')),
      region: clean(formData.get('region')),
      postal_code: clean(formData.get('postal_code')),
      country: clean(formData.get('country')),
      opening_hours: hours,
      details_updated_at: new Date().toISOString(),
    })
    .eq('id', portal.group.id);

  if (written.error) {
    return { ok: false, message: 'Could not save that. Try again.' };
  }

  revalidatePath(`/portal/${token}/update-info`);
  return { ok: true, message: 'Saved. Thank you.' };
}

/**
 * The onboarding form.
 *
 * Stored as a submission rather than written straight onto the record: it is
 * something the practice said at a point in time, and the answers are reviewed
 * before they become the practice's details.
 */
export async function submitOnboardingForm(
  token: string,
  formData: FormData,
): Promise<PortalResult> {
  const portal = await requireGroup(token);
  if (!portal) return NO_ACCESS;

  const payload: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string' && value.trim() !== '') {
      payload[key] = value.trim();
    }
  }

  if (Object.keys(payload).length === 0) {
    return { ok: false, message: 'Fill in at least one answer first.' };
  }

  const db = serviceClient();

  const written = await db.from('form_submissions').insert({
    form_key: 'onboarding',
    client_group_id: portal.group.id,
    client_id: portal.locationIds[0] ?? null,
    payload,
  });

  if (written.error) {
    return { ok: false, message: 'Could not send that. Try again.' };
  }

  await notifyStaff(
    `Onboarding form submitted — ${portal.group.name}`,
    'Answers are on the Forms page.',
    '/forms',
  );

  revalidatePath(`/portal/${token}/onboarding`);
  return { ok: true, message: 'Sent. Your onboarding manager will pick this up.' };
}

/** Asks for a colleague to be given access. Deliberately a request, not a grant. */
export async function requestPortalInvite(
  token: string,
  formData: FormData,
): Promise<PortalResult> {
  const portal = await requireGroup(token);
  if (!portal) return NO_ACCESS;

  const name = clean(formData.get('name'));
  const email = clean(formData.get('email'));

  if (name === null || email === null) {
    return { ok: false, message: 'We need a name and an email address.' };
  }

  const db = serviceClient();

  const written = await db.from('form_submissions').insert({
    form_key: 'portal_invite_request',
    client_group_id: portal.group.id,
    payload: {
      name,
      email,
      role: clean(formData.get('role')),
      requested_by: clean(formData.get('requested_by')),
    },
  });

  if (written.error) {
    return { ok: false, message: 'Could not send that. Try again.' };
  }

  await notifyStaff(
    `Portal access requested — ${portal.group.name}`,
    `${name} (${email})`,
    '/forms',
  );

  return {
    ok: true,
    message:
      'Asked. We will send them their own link rather than forwarding yours.',
  };
}

/**
 * Tells the staff who can act on it.
 *
 * Best-effort by design: the clinic's submission is already saved, so a failure
 * to notify must not read to them as a failure to send.
 */
async function notifyStaff(
  title: string,
  body: string,
  href: string,
): Promise<void> {
  const db = serviceClient();

  const admins = await db
    .from('user_profiles')
    .select('id')
    .eq('role', 'admin');

  if (admins.error || !admins.data || admins.data.length === 0) return;

  await db.from('notifications').insert(
    admins.data.map((admin) => ({
      user_id: admin.id,
      kind: 'info' as const,
      title,
      body,
      href,
    })),
  );
}
