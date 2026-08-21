'use server';

/**
 * Persists the colour theme on the signed-in user's own profile.
 *
 * Scoped to the caller — it writes to their row and no other, so this is safe
 * for any signed-in role rather than admin-only.
 */
import { currentCaller } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export async function saveTheme(theme: 'dark' | 'light'): Promise<void> {
  if (theme !== 'dark' && theme !== 'light') return;

  const caller = await currentCaller();
  if (!caller) return;

  // Best-effort: the toggle has already applied visually and stored locally,
  // so a failed write should not throw back into the click handler.
  await serviceClient()
    .from('user_profiles')
    .update({ theme })
    .eq('id', caller.id);
}
