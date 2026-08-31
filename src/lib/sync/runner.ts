/**
 * Every sync runs through here, so every sync leaves the same evidence behind:
 * one sync_runs row with counts, errors and a duration. When a sync breaks at
 * 3am — and one will — this table is the first thing to read.
 *
 * A sync never throws out of runSync(). A crash still closes its row with
 * status 'error' and the message, because a run that vanished is worse than a
 * run that failed.
 */
import type { Json, SyncTrigger } from '@/types/database';

import { alertSyncFailure } from '@/lib/notify/slack';
import { NotConfiguredError } from '@/lib/env';
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
  /**
   * A finding worth keeping: written to sync_runs.meta rather than the console.
   *
   * The difference matters. `log` goes to the platform's log viewer, so the
   * one person who could act on a diagnostic has to go hunting for it; a note
   * lands in a table they already read. Use it for shapes and counts, never
   * for a patient's details — this column is read by anybody with admin.
   */
  note(key: string, value: unknown): void;
}

export type SyncFn = (ctx: SyncContext) => Promise<void>;

/**
 * Turns anything thrown into something legible.
 *
 * Supabase returns plain objects rather than Error instances, so the usual
 * `error instanceof Error ? error.message : String(error)` renders them as
 * "[object Object]" — which is how a fatal database error can end up telling
 * you nothing at all.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const parts = (['message', 'code', 'details', 'hint'] as const)
      .filter((key) => typeof record[key] === 'string' && record[key] !== '')
      .map((key) => `${key}: ${String(record[key])}`);

    if (parts.length > 0) return parts.join(' | ');

    try {
      return JSON.stringify(error).slice(0, 500);
    } catch {
      return 'an error that could not be serialised';
    }
  }

  return String(error);
}

export interface SyncResult {
  runId: string | null;
  name: string;
  status: 'success' | 'partial' | 'error' | 'skipped';
  counts: SyncCounts;
  errors: Array<{ message: string; context?: Record<string, unknown> }>;
  durationMs: number;
}

/**
 * Which kill-switch group each sync belongs to.
 *
 * Explicit rather than inferred from the name. This was previously derived
 * from prefixes ('meta-' meant ads), and renaming meta-ads to windsor-ads
 * silently dropped it into the 'calls' group, which was switched off — so the
 * ads sync reported "skipped" for days without anyone asking it to stop.
 */
const SYNC_GROUPS: Record<string, string> = {
  'crm-clients': 'crm',
  'crm-appointments': 'crm',
  'crm-deals': 'crm',
  'crm-calls': 'calls',
  'windsor-ads': 'ads',
  'stripe-charges': 'billing',
};

/**
 * Checks the app_settings kill switch.
 *
 * A sync with no group mapping runs. A kill switch should only stop what someone
 * deliberately switched off; defaulting to "off" means a typo silently disables
 * a sync, which is the worst of both worlds.
 */
async function isEnabled(name: string): Promise<boolean> {
  const group = SYNC_GROUPS[name];
  if (!group) return true;

  const db = serviceClient();
  const { data } = await db
    .from('app_settings')
    .select('value')
    .eq('key', 'sync_enabled')
    .maybeSingle();

  if (!data || typeof data.value !== 'object' || data.value === null) return true;

  const flags = data.value as Record<string, unknown>;
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

  /** Findings the sync wants to survive the run. See ctx.note. */
  const notes: Record<string, unknown> = {};

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
    note(key, value) {
      notes[key] = value;
    },
  };

  let fatal: string | null = null;

  try {
    await fn(ctx);
  } catch (error) {
    /*
     * An integration with no credentials is not a failure and must not be
     * reported as one. Recorded exactly the way a disabled sync is — a closed
     * row with meta.skipped and the reason — so it stays visible on the
     * dashboard without turning the nightly cycle red every night until
     * somebody sets a token.
     */
    if (error instanceof NotConfiguredError) {
      await db
        .from('sync_runs')
        .update({
          status: 'success',
          ended_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
          meta: { ...notes, skipped: true, reason: error.message },
        })
        .eq('id', runId);

      return {
        runId,
        name,
        status: 'skipped',
        counts,
        errors,
        durationMs: Date.now() - startedAt,
      };
    }

    fatal = describeError(error);
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
      ...(Object.keys(notes).length > 0
        ? { meta: notes as unknown as Json }
        : {}),
      // Cap the payload: a sync that fails on every one of 10,000 rows should
      // not write a megabyte of near-identical JSON.
      //
      // The cast is needed because the column is jsonb and its generated type
      // is the recursive Json union, which a concrete interface array does not
      // structurally satisfy even though it serialises fine.
      errors: errors.slice(0, 50) as unknown as Json,
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
