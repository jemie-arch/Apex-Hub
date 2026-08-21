/**
 * Every sync runs through here, so every sync leaves the same evidence behind:
 * one sync_runs row with counts, errors and a duration. When a sync breaks at
 * 3am — and one will — this table is the first thing to read.
 *
 * A sync never throws out of runSync(). A crash still closes its row with
 * status 'error' and the message, because a run that vanished is worse than a
 * run that failed.
 */
import type { SyncTrigger } from '@/types/database';

import { alertSyncFailure } from '@/lib/notify/slack';
import { serviceClient } from '@/lib/supabase/service';

export interface SyncCounts {
  read: number;
  created: number;
  updated: number;
  skipped: number;
}

export interface SyncContext {
  runId: string;
  counts: SyncCounts;
  /** Non-fatal problems. One bad record must not lose the other 500. */
  recordError(message: string, context?: Record<string, unknown>): void;
  log(message: string): void;
}

export type SyncFn = (ctx: SyncContext) => Promise<void>;

export interface SyncResult {
  runId: string | null;
  name: string;
  status: 'success' | 'partial' | 'error' | 'skipped';
  counts: SyncCounts;
  errors: Array<{ message: string; context?: Record<string, unknown> }>;
  durationMs: number;
}

/** Checks the app_settings kill switch. Unknown keys default to enabled. */
async function isEnabled(name: string): Promise<boolean> {
  const db = serviceClient();
  const { data } = await db
    .from('app_settings')
    .select('value')
    .eq('key', 'sync_enabled')
    .maybeSingle();

  if (!data || typeof data.value !== 'object' || data.value === null) return true;

  const flags = data.value as Record<string, unknown>;
  const group = name.startsWith('crm-')
    ? 'crm'
    : name.startsWith('meta-')
      ? 'ads'
      : 'calls';

  return flags[group] !== false;
}

export async function runSync(
  name: string,
  trigger: SyncTrigger,
  fn: SyncFn,
  options: { clientId?: string } = {},
): Promise<SyncResult> {
  const db = serviceClient();
  const startedAt = Date.now();

  const counts: SyncCounts = { read: 0, created: 0, updated: 0, skipped: 0 };
  const errors: Array<{ message: string; context?: Record<string, unknown> }> = [];

  if (!(await isEnabled(name))) {
    // Recorded, not silent: a disabled sync should be visible on the dashboard.
    const { data } = await db
      .from('sync_runs')
      .insert({
        name,
        status: 'success',
        triggered_by: trigger,
        ended_at: new Date().toISOString(),
        duration_ms: 0,
        meta: { skipped: true, reason: 'disabled in app_settings' },
        ...(options.clientId ? { client_id: options.clientId } : {}),
      })
      .select('id')
      .maybeSingle();

    return {
      runId: data?.id ?? null,
      name,
      status: 'skipped',
      counts,
      errors,
      durationMs: 0,
    };
  }

  const opened = await db
    .from('sync_runs')
    .insert({
      name,
      status: 'running',
      triggered_by: trigger,
      ...(options.clientId ? { client_id: options.clientId } : {}),
    })
    .select('id')
    .maybeSingle();

  if (opened.error || !opened.data) {
    throw new Error(
      `Could not open a sync_runs row for "${name}": ${opened.error?.message}`,
    );
  }

  const runId = opened.data.id;

  const ctx: SyncContext = {
    runId,
    counts,
    recordError(message, context) {
      errors.push(context ? { message, context } : { message });
      console.error(`[${name}] ${message}`, context ?? '');
    },
    log(message) {
      console.log(`[${name}] ${message}`);
    },
  };

  let fatal: string | null = null;

  try {
    await fn(ctx);
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    errors.push({ message: `fatal: ${fatal}` });
  }

  const durationMs = Date.now() - startedAt;
  const status: SyncResult['status'] = fatal
    ? 'error'
    : errors.length > 0
      ? 'partial'
      : 'success';

  await db
    .from('sync_runs')
    .update({
      status,
      ended_at: new Date().toISOString(),
      duration_ms: durationMs,
      records_read: counts.read,
      records_created: counts.created,
      records_updated: counts.updated,
      records_skipped: counts.skipped,
      error_count: errors.length,
      // Cap the payload: a sync that fails on every one of 10,000 rows should
      // not write a megabyte of near-identical JSON.
      errors: errors.slice(0, 50),
    })
    .eq('id', runId);

  // Awaited, not fire-and-forget: on a serverless platform the function can be
  // frozen the moment the response is returned, which would drop the alert.
  // alertSyncFailure never throws and stays silent on success.
  await alertSyncFailure({
    name,
    status,
    counts,
    errors,
    durationMs,
    triggeredBy: trigger,
  });

  return { runId, name, status, counts, errors, durationMs };
}
