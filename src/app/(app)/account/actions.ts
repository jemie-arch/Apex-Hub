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

export async function signOut(): Promise<void> {
  // A server action can set cookies, so this clears the session properly
  // rather than only forgetting it client-side.
  await serverClient().auth.signOut();
  redirect('/login');
}
