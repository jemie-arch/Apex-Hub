/**
 * Build-order step 1's gate: prove that 0001_init.sql rebuilds the whole
 * database from a fresh clone.
 *
 *   npm run db:verify          check the migration applies to an empty database
 *   npm run db:verify -- --apply   apply it, then check
 *
 * Refuses to run against a database that already has application tables, so it
 * can never be the thing that drops production.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import 'dotenv/config';
import { Client } from 'pg';

const MIGRATION = resolve(process.cwd(), 'supabase/migrations/0001_init.sql');

const EXPECTED_TABLES = [
  'ad_level_insights',
  'ad_snapshots',
  'ads',
  'app_settings',
  'appointments',
  'call_recordings',
  'calls',
  'campaigns',
  'client_notes',
  'client_tasks',
  'clients',
  'deals',
  'finance_entries',
  'form_submissions',
  'notifications',
  'oauth_tokens',
  'sales_calls',
  'sync_runs',
  'user_profiles',
];

const EXPECTED_ENUMS = [
  'appointment_outcome',
  'appointment_status',
  'call_direction',
  'call_outcome',
  'client_status',
  'deal_stage',
  'finance_kind',
  'funnel',
  'notification_kind',
  'sync_status',
  'sync_trigger',
  'task_status',
  'user_role',
];

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error('SUPABASE_DB_URL is not set. See .env.example.');
  }

  const apply = process.argv.includes('--apply');
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const existing = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by 1`,
    );
    const present = existing.rows.map((r) => r.tablename);

    if (apply) {
      if (present.length > 0) {
        throw new Error(
          `Refusing to apply: public schema already holds ${present.length} ` +
            `table(s): ${present.join(', ')}.\n` +
            'Reset the database first, or run without --apply to check only.',
        );
      }

      console.log('Applying 0001_init.sql to an empty database...');
      await client.query(readFileSync(MIGRATION, 'utf8'));
      console.log('Applied.');
    }

    const tables = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by 1`,
    );
    const enums = await client.query<{ typname: string }>(
      `select t.typname
         from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
        where t.typtype = 'e' and n.nspname = 'public'
        order by 1`,
    );
    const rls = await client.query<{ tablename: string }>(
      `select c.relname as tablename
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        order by 1`,
    );

    const found = new Set(tables.rows.map((r) => r.tablename));
    const foundEnums = new Set(enums.rows.map((r) => r.typname));
    const rlsOn = new Set(rls.rows.map((r) => r.tablename));

    const problems: string[] = [];

    for (const table of EXPECTED_TABLES) {
      if (!found.has(table)) problems.push(`missing table: ${table}`);
      else if (!rlsOn.has(table)) problems.push(`RLS not enabled: ${table}`);
    }
    for (const name of EXPECTED_ENUMS) {
      if (!foundEnums.has(name)) problems.push(`missing enum: ${name}`);
    }
    for (const table of found) {
      if (!EXPECTED_TABLES.includes(table)) {
        problems.push(`unexpected table not in the migration: ${table}`);
      }
    }

    if (problems.length > 0) {
      console.error('\nSchema verification FAILED:');
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
      return;
    }

    console.log(
      `\nSchema OK: ${EXPECTED_TABLES.length} tables, ` +
        `${EXPECTED_ENUMS.length} enums, RLS enabled on all tables.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
