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
  /*
   * Checked here, not in the component that renders the button — and answered
   * rather than thrown.
   *
   * requireAdmin throws a plain Error, which in a server action becomes a 500
   * with a digest and no message. This page is reached by permission, not by
   * role: middleware admits anyone holding 'settings', and the page itself
   * queries with the service role, so a teammate granted that key sees all
   * fifteen Run now buttons. Pressing one gave them an unhandled 500 and a
   * button that flicked back to "Run now" as though nothing had happened.
   *
   * Found from the other side of it: a session on the 'tech' account posted
   * two of these and both came back 500, which read as a broken sync until the
   * network log showed the action itself had failed.
   *
   * Who may run a sync is unchanged. Only the answer is: a refusal the button
   * can display, instead of a crash it cannot.
   */
  try {
    await requireAdmin();
  } catch {
    return {
      ok: false,
      message:
        'Running a sync by hand needs an admin. Your account can see this ' +
        'page but not start a sync.',
    };
  }

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
