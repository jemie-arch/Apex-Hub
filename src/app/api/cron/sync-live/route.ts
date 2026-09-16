/**
 * The tracker's feeds, every fifteen minutes.
 *
 * sync-all runs once a day at 06:00 and that was the whole refresh rate of the
 * Client Fulfilment Tracker: a booking made at 9am showed up the next morning.
 * Joshua wants the numbers live. Two things stand between "daily" and "live",
 * and this route is the first of them.
 *
 * WHAT RUNS HERE, and why only these.
 *
 * The tracker's rows come from four feeds plus one derivation:
 *
 *   fulfilment-tracker, fulfilment-leads  the sheet the ISRs fill in  (~3s each)
 *   stat-sheets                           every practice's stat sheet (~46s)
 *   appointment-ledger                    derived from the above       (~1s)
 *
 * Those fit comfortably in a quarter-hour cycle and cost one Google Sheets
 * read each per sheet, which is well inside the API's quota at this cadence.
 *
 * WHAT DOES NOT RUN HERE, and where it went.
 *
 *   windsor-ads    ~116s. Has its own hourly cron entry in vercel.json. Every
 *                  fifteen minutes would be waste: Windsor refreshes its own
 *                  copy of Meta's numbers a few times a day, and Meta itself
 *                  restates the last few days as conversions settle. Hourly is
 *                  as live as the source allows.
 *
 *   crm-appointments  ~207s on a full pass, up to 281s - nearly the whole 300s
 *                  a function is allowed. Its own hourly route, sync-appointments,
 *                  runs it with a short window instead. Putting it here would
 *                  recreate the failure sync-all was written about: everything
 *                  after it never starts.
 *
 * appointment-ledger IS here even though crm-appointments is not, because the
 * ledger reads tracker_appointments as well and a booking written to the sheet
 * at 9:05 should be on the tracker at 9:15, not at 10:30.
 *
 * Sequential, same as sync-all, for the same reasons.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { authorisedCron } from '@/lib/cron';
import { findSync } from '@/lib/sync/registry';
import { runSync, type SyncResult } from '@/lib/sync/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ORDER = [
  'fulfilment-tracker',
  'fulfilment-leads',
  'stat-sheets',
  // Reads what the three above write, so it goes last.
  'appointment-ledger',
] as const;

/** Stop starting new syncs here, leaving headroom for whatever is in flight. */
const START_BUDGET_MS = 200_000;

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
    { status: failed.length > 0 ? 500 : 200 },
  );
}

/** POST is allowed so an admin can trigger the cycle by hand. */
export const POST = GET;
