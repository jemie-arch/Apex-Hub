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
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  canAssign,
  isPrivileged,
  isUserRole,
} from '@/config/roles';
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

/**
 * Sets the role. Separate from keys: role decides reach, keys decide menu.
 *
 * Written to BOTH the profile row and the JWT's app_metadata. The app and every
 * row-level security policy read the role from the token, not the table, so
 * updating only user_profiles changed what this screen displayed and nothing
 * whatsoever about what the person could do.
 */
export async function setRole(input: {
  userId: string;
  role: string;
}): Promise<AccessResult> {
  const caller = await requireAdmin();

  if (!isUserRole(input.role) || !ASSIGNABLE_ROLES.includes(input.role)) {
    // 'client' is deliberately excluded: a client login needs a business
    // attached, which this screen does not collect.
    return {
      ok: false,
      message: `Choose one of: ${ASSIGNABLE_ROLES.map((r) => ROLE_LABELS[r]).join(', ')}.`,
    };
  }

  if (!canAssign(caller.role, input.role)) {
    return {
      ok: false,
      message: 'Only a super admin can grant or remove super admin.',
    };
  }

  if (caller.id === input.userId && !isPrivileged(input.role)) {
    return {
      ok: false,
      message: 'You cannot demote yourself — ask another admin to do it.',
    };
  }

  const db = serviceClient();

  const written = await db
    .from('user_profiles')
    .update({ role: input.role })
    .eq('id', input.userId);

  if (written.error) return { ok: false, message: written.error.message };

  const claim = await db.auth.admin.updateUserById(input.userId, {
    app_metadata: { role: input.role },
  });

  if (claim.error) {
    return {
      ok: false,
      message:
        `Saved the role but could not update the login token: ${claim.error.message}. ` +
        'Their access is unchanged until this succeeds.',
    };
  }

  revalidatePath('/settings/access');
  revalidatePath('/hr');

  return {
    ok: true,
    message:
      `Role set to ${ROLE_LABELS[input.role]}. ` +
      'They will see the change after signing out and back in.',
  };
}

/**
 * Adds a teammate.
 *
 * Creates the login and the profile, and deliberately sends no email: an invite
 * would be a message going out under the company's name, which is not this
 * screen's decision to make. Hand them the address and let them use "Forgot
 * password" to set one, or send your own invite.
 */
export async function addTeammate(input: {
  email: string;
  fullName: string;
  role: string;
  keys?: string[];
}): Promise<AccessResult> {
  const caller = await requireAdmin();

  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: 'That does not look like an email address.' };
  }
  if (fullName === '') {
    return { ok: false, message: 'Give them a name, so the team list is readable.' };
  }
  if (!isUserRole(input.role) || !ASSIGNABLE_ROLES.includes(input.role)) {
    return { ok: false, message: 'Pick a role.' };
  }
  if (!canAssign(caller.role, input.role)) {
    return {
      ok: false,
      message: 'Only a super admin can create another super admin.',
    };
  }

  const db = serviceClient();

  const existing = await db
    .from('user_profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing.error) return { ok: false, message: existing.error.message };
  if (existing.data) {
    return {
      ok: false,
      message: `${email} already has an account. Change their role below instead.`,
    };
  }

  const keys = [...new Set((input.keys ?? []).filter(isPermissionKey))];

  const created = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { role: input.role },
    user_metadata: { full_name: fullName },
  });

  if (created.error || !created.data.user) {
    return {
      ok: false,
      message: created.error?.message ?? 'Could not create the login.',
    };
  }

  // A trigger may already have made the profile row from the auth user, so this
  // updates whatever is there rather than assuming it can insert.
  const profile = await db
    .from('user_profiles')
    .upsert(
      {
        id: created.data.user.id,
        email,
        full_name: fullName,
        role: input.role,
        permissions: keys,
      },
      { onConflict: 'id' },
    );

  if (profile.error) {
    return {
      ok: false,
      message:
        `Created the login but not the profile: ${profile.error.message}. ` +
        'Set their role and pages below.',
    };
  }

  revalidatePath('/settings/access');
  revalidatePath('/hr');

  return {
    ok: true,
    message:
      `Added ${fullName} as ${ROLE_LABELS[input.role]} with ${keys.length} page(s). ` +
      'No email was sent — ask them to sign in with "Forgot password" to set one.',
  };
}
