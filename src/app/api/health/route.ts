/**
 * Configuration health check.
 *
 * Reports which environment variables and integrations are wired, by NAME
 * only — never a value, not even a partial one. Exists because a missing
 * variable otherwise surfaces as an opaque 500 from whichever page happened to
 * touch it first, which is a poor way to find out.
 *
 * Guarded by CRON_SECRET: the shape of a deployment's configuration is not
 * something to hand to anyone who asks.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/** Required to boot at all. */
const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
] as const;

/** Needed only by the integration each one belongs to. */
const OPTIONAL = [
  'GHL_CLIENT_ID',
  'GHL_CLIENT_SECRET',
  'GHL_REDIRECT_URI',
  'GHL_API_BASE',
  'GHL_API_VERSION',
  'WINDSOR_API_KEY',
  'WINDSOR_API_BASE',
  'SERVICE_API_KEY',
  'SLACK_WEBHOOK_URL',
  'NEXT_PUBLIC_APP_URL',
] as const;

function isSet(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '';
}

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace('Bearer ', '');

  // Compared before anything else is read, and deliberately vague on failure.
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const missingRequired = REQUIRED.filter((name) => !isSet(name));
  const setOptional = OPTIONAL.filter((name) => isSet(name));
  const unsetOptional = OPTIONAL.filter((name) => !isSet(name));

  // Only attempt the database once the key it needs is known to be present.
  let database: string;
  let counts: Record<string, number> | null = null;

  if (missingRequired.includes('SUPABASE_SERVICE_ROLE_KEY')) {
    database = 'not attempted — SUPABASE_SERVICE_ROLE_KEY is not set';
  } else {
    try {
      const db = serviceClient();
      const [groups, locations, tokens, runs] = await Promise.all([
        db.from('client_groups').select('id', { count: 'exact', head: true }),
        db.from('clients').select('id', { count: 'exact', head: true }),
        db
          .from('oauth_tokens')
          .select('id', { count: 'exact', head: true })
          .eq('provider', 'gohighlevel'),
        db.from('sync_runs').select('id', { count: 'exact', head: true }),
      ]);

      const failure = groups.error ?? locations.error ?? tokens.error ?? runs.error;
      if (failure) {
        database = `reachable but query failed: ${failure.message}`;
      } else {
        database = 'ok';
        counts = {
          businesses: groups.count ?? 0,
          locations: locations.count ?? 0,
          crm_tokens: tokens.count ?? 0,
          sync_runs: runs.count ?? 0,
        };
      }
    } catch (error) {
      database = error instanceof Error ? error.message : 'unreachable';
    }
  }

  return NextResponse.json(
    {
      ok: missingRequired.length === 0 && database === 'ok',
      missingRequired,
      configured: setOptional,
      notConfigured: unsetOptional,
      database,
      counts,
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
