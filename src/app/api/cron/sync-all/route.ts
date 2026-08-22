/**
 * Runs every sync, in order, on one schedule.
 *
 * This exists because of an arithmetic problem. Vercel's Hobby plan allows two
 * cron entries, and there are six syncs. So vercel.json scheduled the two that
 * seemed most important and the other four — crm-clients, crm-deals, crm-calls
 * and stripe-charges — had no schedule at all. They were only ever going to run
 * if somebody remembered to press a button, which is the same as saying they
 * were not going to run.
 *
 * One cron entry pointing here covers all of them, so adding a seventh sync is
 * a change to the registry rather than a fight with the plan limit.
 *
 * Sequential, not parallel. These syncs share a GoHighLevel token and a rate
 * limit, and crm-appointments depends on crm-clients having created the client
 * rows first. Running them concurrently would race on both.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { authorisedCron } from '@/lib/cron';
import { findSync } from '@/lib/sync/registry';
import { runSync, type SyncResult } from '@/lib/sync/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Order matters.
 *
 * crm-clients first: it creates the client rows every other sync joins to. A
 * new sub-account added in GoHighLevel this morning has no appointments imported
 * until its client row exists, and doing it in the other order delays that by a
 * full day.
 *
 * stripe-charges last: it is the cheapest and the least urgent, so it is the
 * right thing to lose if the budget runs out.
 */
const ORDER = [
  'crm-clients',
  // After clients so the agency token and location rows exist, and early enough
  // that a scope granted this morning repairs the backlog today rather than
  // waiting on somebody noticing a button.
  'provision-pending',
  'onboarding-calls',
  'crm-appointments',
  'crm-deals',
  'crm-calls',
  'windsor-ads',
  'stripe-charges',
] as const;

/**
 * When to stop starting new syncs.
 *
 * maxDuration is 300s and the platform kills the function at that point, mid-
 * write, with the sync_runs row left saying 'running' forever. So stop *starting*
 * work at 240s and leave the remainder as headroom for whatever is in flight.
 *
 * crm-appointments alone has taken 182s on a full import, so overrunning is a
 * real possibility rather than a theoretical one.
 */
const START_BUDGET_MS = 240_000;

interface CycleEntry {
  name: string;
  status: SyncResult['status'] | 'not_started';
  durationMs: number;
  counts?: SyncResult['counts'];
  errorCount?: number;
  reason?: string;
}

export async function GET(request: NextRequest) {
  let allowed: boolean;
  try {
    allowed = authorisedCron(request);
  } catch (error) {
    // CRON_SECRET missing: say so rather than returning a bare 401 that looks
    // like a wrong key.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'not configured' },
      { status: 503 },
    );
  }

  if (!allowed) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const startedAt = Date.now();
  const entries: CycleEntry[] = [];

  for (const name of ORDER) {
    const definition = findSync(name);

    if (!definition) {
      // A name in ORDER that is not in the registry is a typo, and a typo here
      // silently drops a sync — exactly the failure this route was written to
      // remove. Report it rather than skipping quietly.
      entries.push({
        name,
        status: 'not_started',
        durationMs: 0,
        reason: 'not found in the sync registry — check the name',
      });
      continue;
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed > START_BUDGET_MS) {
      entries.push({
        name,
        status: 'not_started',
        durationMs: 0,
        reason: `ran out of time after ${Math.round(elapsed / 1000)}s — runs on the next cycle`,
      });
      continue;
    }

    try {
      const result = await runSync(definition.name, 'cron', definition.run);
      entries.push({
        name,
        status: result.status,
        durationMs: result.durationMs,
        counts: result.counts,
        errorCount: result.errors.length,
      });
    } catch (error) {
      // runSync can throw before it opens its sync_runs row — a bad
      // service-role key, say. One sync failing that way must not stop the
      // rest of the cycle.
      entries.push({
        name,
        status: 'error',
        durationMs: 0,
        reason:
          error instanceof Error
            ? `failed before start: ${error.message}`
            : 'failed before start',
      });
    }
  }

  const failed = entries.filter((entry) => entry.status === 'error');
  const skipped = entries.filter((entry) => entry.status === 'not_started');

  return NextResponse.json(
    {
      cycleMs: Date.now() - startedAt,
      ran: entries.length - skipped.length,
      failed: failed.length,
      skipped: skipped.length,
      syncs: entries,
    },
    // Red in the platform's cron log when a sync broke outright. A 'partial'
    // is not a failure of the cycle — stripe-charges reports partial whenever a
    // client's card was declined, which is information, not a fault.
    { status: failed.length > 0 ? 500 : 200 },
  );
}

/** POST is allowed so an admin can trigger the whole cycle by hand. */
export const POST = GET;
