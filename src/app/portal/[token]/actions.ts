'use server';

/**
 * Outcome updates from the client portal.
 *
 * The portal is unauthenticated, so the token is the credential — and it is
 * re-checked here on every write. A server action is a POST endpoint anyone can
 * call with any appointment id, so this must never trust the id alone: it
 * resolves the token to a business, then proves the appointment belongs to one
 * of that business's sub-accounts before writing.
 */
import { revalidatePath } from 'next/cache';

import { serviceClient } from '@/lib/supabase/service';
import type { AppointmentOutcome } from '@/types/database';

const ALLOWED_OUTCOMES: readonly AppointmentOutcome[] = [
  'pending',
  'quoted',
  'won',
  'lost',
  'follow_up',
  'unqualified',
];

export interface OutcomeResult {
  ok: boolean;
  message: string;
}

export async function updateAppointmentOutcome(input: {
  token: string;
  appointmentId: string;
  outcome: string;
  showed: 'yes' | 'no' | 'unknown';
  /** Treatment value in whole currency units, as typed. */
  value: string;
}): Promise<OutcomeResult> {
  const db = serviceClient();

  if (!input.token || !input.appointmentId) {
    return { ok: false, message: 'Missing details.' };
  }

  if (!ALLOWED_OUTCOMES.includes(input.outcome as AppointmentOutcome)) {
    return { ok: false, message: 'That outcome is not recognised.' };
  }

  const group = await db
    .from('client_groups')
    .select('id, portal_enabled')
    .eq('portal_token', input.token)
    .maybeSingle();

  if (group.error) return { ok: false, message: 'Could not verify access.' };
  if (!group.data || !group.data.portal_enabled) {
    return { ok: false, message: 'This link is no longer active.' };
  }

  const locations = await db
    .from('clients')
    .select('id')
    .eq('group_id', group.data.id);
  if (locations.error) return { ok: false, message: 'Could not verify access.' };

  const locationIds = (locations.data ?? []).map((row) => row.id);
  if (locationIds.length === 0) {
    return { ok: false, message: 'This link is no longer active.' };
  }

  // The ownership proof: the id must belong to THIS business. Without the
  // client_id filter, any appointment id would be writable from any portal.
  const owned = await db
    .from('appointments')
    .select('id')
    .eq('id', input.appointmentId)
    .in('client_id', locationIds)
    .maybeSingle();

  if (owned.error) return { ok: false, message: 'Could not verify access.' };
  if (!owned.data) {
    // Deliberately the same message as a bad token: do not reveal whether the
    // appointment exists somewhere else.
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

  const written = await db
    .from('appointments')
    .update({
      outcome: input.outcome as AppointmentOutcome,
      // Only write showed when the person actually said; 'unknown' leaves the
      // existing value alone rather than clearing it.
      //
      // The source stamp stops the next CRM sync replacing it — see
      // crm-appointments.ts, where the clinic's answer wins.
      ...(showed === null ? {} : { showed, showed_source: 'client' }),
      ...(valueCents === null ? {} : { value_cents: valueCents }),
      outcome_updated_at: new Date().toISOString(),
    })
    .eq('id', input.appointmentId);

  if (written.error) {
    return { ok: false, message: 'Could not save that. Try again.' };
  }

  revalidatePath(`/portal/${input.token}`);
  return { ok: true, message: 'Saved.' };
}
