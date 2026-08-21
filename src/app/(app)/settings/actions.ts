'use server';

/**
 * Admin-triggered sync. Calls exactly the same function the cron route and the
 * CLI call — a sync must not behave differently depending on who started it.
 */
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/supabase/server';
import { findSync } from '@/lib/sync/registry';
import { runSync } from '@/lib/sync/runner';

export interface RunSyncState {
  ok: boolean;
  message: string;
}

export async function runSyncNow(name: string): Promise<RunSyncState> {
  // Checked here, not in the component that renders the button.
  await requireAdmin();

  const definition = findSync(name);
  if (!definition) {
    return { ok: false, message: `Unknown sync "${name}".` };
  }

  const result = await runSync(definition.name, 'manual', definition.run);

  revalidatePath('/settings');
  revalidatePath('/dashboard');
  revalidatePath('/clients');

  const counts =
    `read ${result.counts.read}, created ${result.counts.created}, ` +
    `updated ${result.counts.updated}, skipped ${result.counts.skipped}`;

  if (result.status === 'error') {
    const first = result.errors[0]?.message ?? 'no detail recorded';
    return { ok: false, message: `Failed: ${first}` };
  }

  if (result.status === 'partial') {
    return {
      ok: false,
      message: `Finished with ${result.errors.length} error(s) — ${counts}. See sync_runs.`,
    };
  }

  return { ok: true, message: `Done in ${result.durationMs}ms — ${counts}.` };
}
