'use server';

/**
 * Marking what the bell is counting as read.
 *
 * Guarded by the caller's own id rather than by a permission key. There is no
 * page here to hold a key for, and the rule is simpler than a key anyway: you
 * may mark your own notifications read and nobody else's. The `.eq('user_id',
 * caller.id)` on every write is what enforces it — an id passed from a browser
 * that belongs to somebody else's row matches nothing and changes nothing.
 */
import { revalidatePath } from 'next/cache';

import { currentCaller } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export interface NotificationResult {
  ok: boolean;
  message: string;
}

/**
 * Marks everything unread as read, or just the ids given.
 *
 * Both shapes exist because both actions are real: "mark all read" clears the
 * count deliberately, and opening one notification clears that one — leaving
 * the rest of the count alone, so following a link does not quietly dismiss
 * five other things you had not looked at.
 */
export async function markNotificationsRead(
  ids?: readonly string[],
): Promise<NotificationResult> {
  const caller = await currentCaller();
  if (!caller) return { ok: false, message: 'Not signed in.' };

  let query = serviceClient()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', caller.id)
    // Already-read rows keep their original timestamp: when somebody first saw
    // a thing is worth more than when they last pressed a button.
    .is('read_at', null);

  if (ids && ids.length > 0) query = query.in('id', ids);

  const written = await query;

  if (written.error) return { ok: false, message: written.error.message };

  /*
   * The layout renders the bell on every page, so the count is stale everywhere
   * until the layout re-runs. revalidatePath with 'layout' is what reaches it —
   * revalidating a single page would leave the badge wrong on the next click.
   */
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Marked read.' };
}
