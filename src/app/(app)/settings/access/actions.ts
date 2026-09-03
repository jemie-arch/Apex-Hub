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
  /**
   * A single-use set-password link, when one was generated.
   *
   * Returned rather than emailed. Treat it as a credential: whoever holds it can
   * set this person's password until it is used or expires.
   */
  link?: string;
}

/**
 * This site's own address, for a link somebody will paste into a message.
 *
 * A relative path is useless once it leaves the app, and a guessed hostname
 * would send a new teammate somewhere that does not exist, so this returns null
 * rather than inventing one.
 */
function siteOrigin(): string | null {
  const configured = process.env['NEXT_PUBLIC_APP_URL']?.trim();
  if (configured) return configured.replace(/\/$/, '');

  const vercel =
    process.env['VERCEL_PROJECT_PRODUCTION_URL'] ?? process.env['VERCEL_URL'];
  return vercel ? `https://${vercel}` : null;
}

/**
 * A link that lets somebody choose their own password.
 *
 * generateLink returns the link instead of sending it, which is the point: the
 * account gets created here and the message goes out however you choose, under
 * your name rather than the software's.
 */
async function setPasswordLink(email: string): Promise<
  { ok: true; link: string } | { ok: false; message: string }
> {
  const origin = siteOrigin();
  if (origin === null) {
    return {
      ok: false,
      message:
        'Set NEXT_PUBLIC_APP_URL so the link points at this site rather than nowhere.',
    };
  }

  const generated = await serviceClient().auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${origin}/auth/set-password` },
  });

  if (generated.error || !generated.data.properties?.action_link) {
    return {
      ok: false,
      message: generated.error?.message ?? 'Could not generate a link.',
    };
  }

  return { ok: true, link: generated.data.properties.action_link };
}

/**
 * Issues a fresh set-password link for somebody who already has an account.
 *
 * These links are single use and time limited, so the first one being expired is
 * the normal case rather than a fault.
 */
export async function reissueSetPasswordLink(input: {
  userId: string;
}): Promise<AccessResult> {
  await requireAdmin();

  const person = await serviceClient()
    .from('user_profiles')
    .select('email, full_name')
    .eq('id', input.userId)
    .maybeSingle();

  if (person.error) return { ok: false, message: person.error.message };
  if (!person.data) return { ok: false, message: 'No such person.' };

  const generated = await setPasswordLink(person.data.email);
  if (!generated.ok) return { ok: false, message: generated.message };

  return {
    ok: true,
    message: `New link for ${person.data.full_name ?? person.data.email}. Single use.`,
    link: generated.link,
  };
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
 * An existing login for this address, if there is one.
 *
 * listUsers is paginated and there is no lookup-by-email in this client
 * version, so this walks pages until it finds the address or runs out. Bounded
 * at twenty pages of two hundred: four thousand logins is far beyond this
 * agency, and an unbounded loop against a paginated API is how a server action
 * starts timing out silently.
 */
async function findAuthUserByEmail(
  db: ReturnType<typeof serviceClient>,
  email: string,
): Promise<{ user?: { id: string } | null; error?: string }> {
  for (let page = 1; page <= 20; page += 1) {
    const listed = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) return { error: listed.error.message };

    const hit = listed.data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email,
    );
    if (hit) return { user: { id: hit.id } };

    if (listed.data.users.length < 200) break;
  }
  return { user: null };
}

/**
 * Adds a teammate and returns a link for them to set their own password.
 *
 * No email is sent. The link comes back to you to pass on however you like,
 * which also means no password is ever chosen for somebody else or typed into a
 * chat window.
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

  /*
   * A login may already exist without a profile, and this used to be unfixable
   * from here.
   *
   * Adding somebody through the Supabase dashboard creates the auth user and
   * nothing else — no profile, no role claim. Middleware reads the role from
   * app_metadata and defaults to 'client', so that person authenticates
   * successfully and is redirected out of the app. Meanwhile this action saw no
   * profile, went straight to createUser, and failed on the duplicate email —
   * so the only route out was hand-written SQL. That is exactly what happened
   * on 2 September and it cost an evening.
   *
   * So an orphaned login is adopted rather than rejected: the role claim and
   * name are set on it, and the flow continues as if it had just been made.
   */
  const orphan = await findAuthUserByEmail(db, email);
  if (orphan.error) return { ok: false, message: orphan.error };

  let userId: string;
  let adopted = false;

  if (orphan.user) {
    adopted = true;
    userId = orphan.user.id;

    const claimed = await db.auth.admin.updateUserById(userId, {
      app_metadata: { role: input.role },
      user_metadata: { full_name: fullName },
    });

    if (claimed.error) {
      return {
        ok: false,
        message:
          `${email} already has a login, but its role could not be set: ` +
          `${claimed.error.message}. Until that succeeds they will be treated ` +
          'as a client and redirected out of the app.',
      };
    }
  } else {
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

    userId = created.data.user.id;
  }

  // A trigger may already have made the profile row from the auth user, so this
  // updates whatever is there rather than assuming it can insert.
  const profile = await db
    .from('user_profiles')
    .upsert(
      {
        id: userId,
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

  const generated = await setPasswordLink(email);

  if (!generated.ok) {
    return {
      ok: true,
      message:
        `Added ${fullName} as ${ROLE_LABELS[input.role]} with ${keys.length} page(s), ` +
        `but the set-password link failed: ${generated.message} ` +
        'Use "New link" on their row once that is fixed.',
    };
  }

  return {
    ok: true,
    message:
      (adopted
        ? `${fullName} already had a login, so it was adopted rather than ` +
          `recreated — set to ${ROLE_LABELS[input.role]} with ${keys.length} page(s). ` +
          'Whatever password they already had still works, so they may not need ' +
          'the link at all. '
        : `Added ${fullName} as ${ROLE_LABELS[input.role]} with ${keys.length} page(s). `) +
      'Send them the link below if they need one — it is single use, no email ' +
      'went out, and clicking it twice will report it expired.',
    link: generated.link,
  };
}
