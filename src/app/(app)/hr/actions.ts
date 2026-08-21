'use server';

/**
 * Time off and employment facts.
 *
 * Two different permissions live here on purpose. Raising a request is scoped
 * to the caller's own row — anyone signed in may do it. Deciding one, or
 * editing somebody's title and start date, is admin-only.
 */
import { revalidatePath } from 'next/cache';

import { currentCaller, requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';

type TimeOffKind = Database['public']['Enums']['time_off_kind'];

const KINDS: readonly TimeOffKind[] = [
  'vacation',
  'sick',
  'unpaid',
  'parental',
  'other',
];

export interface TeamResult {
  ok: boolean;
  message: string;
}

function clean(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export async function requestTimeOff(formData: FormData): Promise<TeamResult> {
  const caller = await currentCaller();
  if (!caller) return { ok: false, message: 'Sign in again.' };

  const startsOn = clean(formData.get('starts_on'));
  const endsOn = clean(formData.get('ends_on'));
  const kindRaw = clean(formData.get('kind')) ?? 'vacation';

  if (startsOn === null || endsOn === null) {
    return { ok: false, message: 'Give a first and last day.' };
  }
  if (endsOn < startsOn) {
    return { ok: false, message: 'The last day cannot be before the first.' };
  }
  if (!(KINDS as readonly string[]).includes(kindRaw)) {
    return { ok: false, message: `"${kindRaw}" is not a kind of leave.` };
  }

  // Written with the caller's own id, never one from the form.
  const written = await serviceClient()
    .from('time_off_requests')
    .insert({
      user_id: caller.id,
      kind: kindRaw as TimeOffKind,
      starts_on: startsOn,
      ends_on: endsOn,
      note: clean(formData.get('note')),
    });

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/hr');
  return { ok: true, message: 'Requested. An admin will decide it.' };
}

export async function decideTimeOff(input: {
  id: string;
  approve: boolean;
  note?: string;
}): Promise<TeamResult> {
  const caller = await requireAdmin();

  const written = await serviceClient()
    .from('time_off_requests')
    .update({
      status: input.approve ? 'approved' : 'declined',
      decided_by: caller.id,
      decided_at: new Date().toISOString(),
      decision_note: input.note?.trim() === '' ? null : (input.note ?? null),
    })
    .eq('id', input.id)
    // Only a pending request can be decided, so two admins clicking at once
    // cannot overwrite each other's decision.
    .eq('status', 'pending');

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/hr');
  return { ok: true, message: input.approve ? 'Approved.' : 'Declined.' };
}

export async function saveEmployment(input: {
  userId: string;
  jobTitle: string | null;
  startedOn: string | null;
}): Promise<TeamResult> {
  await requireAdmin();

  const written = await serviceClient()
    .from('user_profiles')
    .update({
      job_title: input.jobTitle,
      started_on: input.startedOn,
    })
    .eq('id', input.userId);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/hr');
  return { ok: true, message: 'Saved.' };
}
