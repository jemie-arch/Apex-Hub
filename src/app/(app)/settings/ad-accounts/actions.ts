'use server';

/**
 * Mapping a Windsor ad account onto a practice.
 *
 * This is the single most consequential thing on the Settings screens, because
 * every cost figure in the app hangs off it: get one wrong and one practice's
 * spend is reported against another's bookings, in a report that goes to the
 * client. So the action refuses to leave an account assigned twice rather than
 * silently allowing it — a duplicate would double-count that spend and quietly
 * halve a cost per booking.
 */
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export interface MapResult {
  ok: boolean;
  message: string;
}

export async function setClientAdAccount(input: {
  clientId: string;
  /** Empty string clears the mapping. */
  accountId: string;
}): Promise<MapResult> {
  await requireAdmin();

  const db = serviceClient();
  const accountId = input.accountId.trim();

  if (accountId === '') {
    const cleared = await db
      .from('clients')
      .update({ ad_account_id: null })
      .eq('id', input.clientId);

    if (cleared.error) return { ok: false, message: cleared.error.message };

    revalidatePath('/settings/ad-accounts');
    return { ok: true, message: 'Cleared.' };
  }

  // Windsor reports ids bare; store them the same way so the sync's lookup
  // matches without needing to strip a prefix twice.
  const bare = accountId.replace(/^act_/, '');

  const taken = await db
    .from('clients')
    .select('id, name')
    .eq('ad_account_id', bare)
    .neq('id', input.clientId)
    .maybeSingle();

  if (taken.error) return { ok: false, message: taken.error.message };
  if (taken.data) {
    return {
      ok: false,
      message: `That account is already mapped to ${taken.data.name}. Clear it there first.`,
    };
  }

  const written = await db
    .from('clients')
    .update({ ad_account_id: bare })
    .eq('id', input.clientId);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/settings/ad-accounts');
  revalidatePath('/ads');
  revalidatePath('/dashboard');

  return { ok: true, message: 'Mapped.' };
}
