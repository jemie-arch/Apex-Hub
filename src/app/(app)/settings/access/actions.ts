'use server';

/**
 * Grants and revokes menu permission keys.
 *
 * Admin-only, checked here rather than in the component that renders the form.
 *
 * Unknown keys are dropped rather than stored: a typo would otherwise sit in
 * the array forever, granting nothing and matching nothing, and would look
 * like a working permission in the database.
 */
import { revalidatePath } from 'next/cache';

import { PERMISSION_KEYS, isPermissionKey } from '@/config/permissions';
import { requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export interface AccessResult {
  ok: boolean;
  message: string;
}

export async function setPermissions(input: {
  userId: string;
  keys: string[];
}): Promise<AccessResult> {
  const caller = await requireAdmin();

  const keys = [...new Set(input.keys.filter(isPermissionKey))];
  const rejected = input.keys.filter((key) => !isPermissionKey(key));

  // Losing your own access to this page would leave nobody able to restore it
  // without a database console.
  if (caller.id === input.userId && !keys.includes('access')) {
    return {
      ok: false,
      message:
        'You cannot remove your own Access & Permissions key — you would not ' +
        'be able to grant it back.',
    };
  }

  const written = await serviceClient()
    .from('user_profiles')
    .update({ permissions: keys })
    .eq('id', input.userId);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/settings/access');
  revalidatePath('/dashboard');

  return {
    ok: true,
    message:
      `Saved ${keys.length} of ${PERMISSION_KEYS.length} pages.` +
      (rejected.length > 0
        ? ` Ignored ${rejected.length} unrecognised key(s).`
        : ''),
  };
}

/** Sets the role. Separate from keys: role decides reach, keys decide menu. */
export async function setRole(input: {
  userId: string;
  role: string;
}): Promise<AccessResult> {
  const caller = await requireAdmin();

  if (!['admin', 'isr', 'csr'].includes(input.role)) {
    // 'client' is deliberately excluded: a client login needs a business
    // attached, which this screen does not collect.
    return { ok: false, message: 'Choose admin, isr or csr.' };
  }

  if (caller.id === input.userId && input.role !== 'admin') {
    return {
      ok: false,
      message: 'You cannot demote yourself — ask another admin to do it.',
    };
  }

  const written = await serviceClient()
    .from('user_profiles')
    .update({ role: input.role as 'admin' | 'isr' | 'csr' })
    .eq('id', input.userId);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/settings/access');
  return { ok: true, message: `Role set to ${input.role}.` };
}
