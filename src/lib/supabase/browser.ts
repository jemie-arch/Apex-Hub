'use client';

/**
 * Browser Supabase client. Anon key only; every read it performs is subject to
 * the RLS policies in the migration.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/env';
import type { Database } from '@/types/database';

let cached: SupabaseClient<Database> | null = null;

export function browserClient(): SupabaseClient<Database> {
  if (cached) return cached;

  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  cached = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  return cached;
}
