/**
 * Service-role Supabase client. Bypasses RLS, so it may only be constructed in
 * API routes, server actions, and CLI scripts — never in anything that reaches
 * the browser. The window guard makes a mistake fail immediately and loudly.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { serverEnv } from '@/lib/env';
import type { Database } from '@/types/database';

let cached: SupabaseClient<Database> | null = null;

export function serviceClient(): SupabaseClient<Database> {
  if (typeof window !== 'undefined') {
    throw new Error(
      'serviceClient() was called in the browser. The service-role key must ' +
        'never leave the server; use browserClient() instead.',
    );
  }

  if (cached) return cached;

  const env = serverEnv();
  cached = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'ops-dashboard' } },
    },
  );

  return cached;
}
