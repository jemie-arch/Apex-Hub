/**
 * Cookie-backed Supabase client for server components and server actions.
 *
 * This is the one that knows WHO is asking — unlike serviceClient(), which
 * bypasses RLS and knows nothing about the caller. Use this to authorise, then
 * serviceClient() to do the work.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/env';
import type { Database } from '@/types/database';
import type { UserRole } from '@/types/database';

export function serverClient(): SupabaseClient<Database> {
  const cookieStore = cookies();
  const { supabaseUrl, supabaseAnonKey } = publicEnv();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
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
  if (!caller || caller.role !== 'admin') {
    throw new Error('Not authorised.');
  }
  return caller;
}
