'use server';

/**
 * Actions on your own account only. Every one of these resolves the target row
 * from the session rather than from the form, so a crafted POST cannot rename
 * or sign out somebody else.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { currentCaller, serverClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export async function saveDisplayName(formData: FormData): Promise<void> {
  const caller = await currentCaller();
  if (!caller) redirect('/login');

  const raw = formData.get('full_name');
  const name = typeof raw === 'string' ? raw.trim() : '';

  await serviceClient()
    .from('user_profiles')
    .update({ full_name: name === '' ? null : name })
    .eq('id', caller.id);

  revalidatePath('/account');
}

export interface TimeOffResult {
  ok: boolean;
  message: string;
}

/**
 * Ask for time off.
 *
 * `user_id` comes from the session, never the form — the same rule as every
 * other action here. Without that, a crafted POST could book leave against
 * somebody else, and approved leave adds hours to a payout.
 *
 * Deliberately cannot set `status`. A request arrives pending and only an admin
 * moves it, which is why the RLS policy grants insert but not update to the
 * requester.
 */
export async function requestTimeOff(
  formData: FormData,
): Promise<TimeOffResult> {
  const caller = await currentCaller();
  if (!caller) redirect('/login');

  const text = (key: string): string => {
    const raw = formData.get(key);
    return typeof raw === 'string' ? raw.trim() : '';
  };

  const startsOn = text('starts_on');
  const endsOn = text('ends_on');
  const kind = text('kind') || 'vacation';
  const note = text('note');

  const KINDS = ['vacation', 'sick', 'unpaid', 'parental', 'other'];
  if (!KINDS.includes(kind)) {
    return { ok: false, message: 'Pick a type of leave.' };
  }
  if (startsOn === '' || endsOn === '') {
    return { ok: false, message: 'Give a first and last day.' };
  }
  if (endsOn < startsOn) {
    // The database enforces this too; catching it here gives a sentence rather
    // than a constraint violation.
    return { ok: false, message: 'The last day cannot be before the first.' };
  }

  const db = serviceClient();

  /*
   * Overlap check. Two live requests covering the same day would each add their
   * own leave hours to the payout period, so the same day off would be paid
   * twice. Cancelled and declined requests are ignored — those are history.
   */
  const clash = await db
    .from('time_off_requests')
    .select('starts_on, ends_on, status')
    .eq('user_id', caller.id)
    .in('status', ['pending', 'approved'])
    .lte('starts_on', endsOn)
    .gte('ends_on', startsOn)
    .limit(1);

  if (clash.error) return { ok: false, message: clash.error.message };
  if ((clash.data ?? []).length > 0) {
    const existing = clash.data![0]!;
    return {
      ok: false,
      message:
        `You already have a ${existing.status} request covering ` +
        `${existing.starts_on} to ${existing.ends_on}. Cancel that one first ` +
        'rather than overlapping it.',
    };
  }

  const created = await db.from('time_off_requests').insert({
    user_id: caller.id,
    starts_on: startsOn,
    ends_on: endsOn,
    kind: kind as 'vacation' | 'sick' | 'unpaid' | 'parental' | 'other',
    note: note === '' ? null : note,
  });

  if (created.error) return { ok: false, message: created.error.message };

  revalidatePath('/account');
  return {
    ok: true,
    message:
      kind === 'unpaid'
        ? 'Requested. Unpaid leave does not add hours to a payout.'
        : 'Requested. Once approved it adds hours to the payout period it falls in.',
  };
}

/**
 * Withdraw your own request, while it is still pending.
 *
 * Scoped to the caller and to pending in the query itself rather than checked
 * first — so a request that an admin has just decided cannot be pulled out from
 * under them by a stale page.
 */
export async function cancelTimeOff(
  formData: FormData,
): Promise<TimeOffResult> {
  const caller = await currentCaller();
  if (!caller) redirect('/login');

  const id = formData.get('id');
  if (typeof id !== 'string' || id === '') {
    return { ok: false, message: 'Which request?' };
  }

  const updated = await serviceClient()
    .from('time_off_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', caller.id)
    .eq('status', 'pending')
    .select('id');

  if (updated.error) return { ok: false, message: updated.error.message };
  if ((updated.data ?? []).length === 0) {
    return {
      ok: false,
      message: 'That request is no longer pending, so it cannot be withdrawn.',
    };
  }

  revalidatePath('/account');
  return { ok: true, message: 'Withdrawn.' };
}

export async function signOut(): Promise<void> {
  // A server action can set cookies, so this clears the session properly
  // rather than only forgetting it client-side.
  await serverClient().auth.signOut();
  redirect('/login');
}
