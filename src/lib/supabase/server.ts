/**
 * Cookie-backed Supabase client for server components and server actions.
 *
 * This is the one that knows WHO is asking — unlike serviceClient(), which
 * bypasses RLS and knows nothing about the caller. Use this to authorise, then
 * serviceClient() to do the work.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import type { PermissionKey } from '@/config/permissions';
import { isPrivileged } from '@/config/roles';
import { publicEnv } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';
import type { Database, UserRole } from '@/types/database';

/** Derived from the factory — see the note in browser.ts. */
type ServerClient = ReturnType<typeof createServerClient<Database>>;

/** The shape @supabase/ssr hands to setAll. */
interface CookieToSet {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

export function serverClient(): ServerClient {
  const cookieStore = cookies();
  const { supabaseUrl, supabaseAnonKey } = publicEnv();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        // A server component cannot set cookies. Middleware already refreshed
        // the session, so swallowing this is correct rather than lossy.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          /* called from a server component render — ignore */
        }
      },
    },
  });
}

export interface Caller {
  id: string;
  email: string | null;
  role: UserRole;
  /** The BUSINESS a client login is scoped to. Null for staff and admin. */
  groupId: string | null;
}

/** The signed-in caller, or null. Reads the role from the JWT, not a table. */
export async function currentCaller(): Promise<Caller | null> {
  const {
    data: { user },
  } = await serverClient().auth.getUser();

  if (!user) return null;

  const role = (user.app_metadata?.['role'] as UserRole | undefined) ?? 'client';
  const groupId = user.app_metadata?.['group_id'];

  return {
    id: user.id,
    email: user.email ?? null,
    role,
    groupId: typeof groupId === 'string' && groupId !== '' ? groupId : null,
  };
}

/**
 * Throws unless the caller is an admin. Server actions are POST endpoints in
 * their own right — a middleware rule on the page that renders the button does
 * not protect the action behind it.
 */
export async function requireAdmin(): Promise<Caller> {
  const caller = await currentCaller();
  if (!caller || !isPrivileged(caller.role)) {
    throw new Error('Not authorised.');
  }
  return caller;
}

/**
 * Throws unless the caller holds a permission key — or is privileged, which
 * reaches everything by definition.
 *
 * requireAdmin is the wrong guard for anything a teammate is supposed to do.
 * Tech support is the case that forced this: Ally is role 'tech', holds the
 * tech_support key, and is who every Slack ticket is assigned to — and under
 * requireAdmin she could see her own tickets and not touch one of them.
 *
 * Read from user_profiles rather than the JWT, the same way middleware does.
 * Permission keys are not mirrored into the token, so a key granted on the
 * access screen takes effect on the next request instead of the next sign-in.
 */
export async function requirePermission(key: PermissionKey): Promise<Caller> {
  const caller = await currentCaller();
  if (!caller) throw new Error('Not authorised.');
  if (isPrivileged(caller.role)) return caller;

  // A client login is scoped to its own practice and holds no staff keys, so
  // it is refused before a lookup that could only ever come back empty.
  if (caller.role === 'client') throw new Error('Not authorised.');

  /*
   * The service client, deliberately, for a read that decides authorisation.
   *
   * currentCaller() has already established who this is from the signed JWT,
   * and the row read is theirs by id — so nothing here trusts input. Going
   * through the cookie-backed client instead would make the answer depend on
   * whether an RLS policy happens to let somebody read their own permissions,
   * and a policy change would then quietly revoke every action on this path
   * rather than failing anywhere visible.
   */
  const profile = await serviceClient()
    .from('user_profiles')
    .select('permissions')
    .eq('id', caller.id)
    .maybeSingle();

  const granted: readonly string[] = profile.data?.permissions ?? [];
  if (!granted.includes(key)) throw new Error('Not authorised.');

  return caller;
}
