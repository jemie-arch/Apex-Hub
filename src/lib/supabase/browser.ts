'use client';

/**
 * Browser Supabase client. Anon key only; every read it performs is subject to
 * the RLS policies in the migration.
 */
import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Derived from the factory rather than annotated as SupabaseClient<Database>:
 * supabase-js carries schema generics beyond the first, so naming the type by
 * hand produces a subtly different one that will not assign.
 */
type BrowserClient = ReturnType<typeof createBrowserClient<Database>>;

let cached: BrowserClient | null = null;

export function browserClient(): BrowserClient {
  if (cached) return cached;

  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  cached = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  return cached;
}
