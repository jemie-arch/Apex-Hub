/**
 * New bookings from GoHighLevel, every hour, without re-reading the whole record.
 *
 * crm-appointments' full pass reads every consultation event since January 2025
 * and takes 200 to 280 seconds against a 300-second limit. It runs that way
 * once a day at 18:00 and must keep doing so: outcomes of past appointments
 * change after the fact, and only the full pass sees them.
 *
 * This route asks for the same calendars but only for events that START from
 * three days ago onward. A booking made this morning for any future date sits
 * inside that window, so nothing new is missed; what is skipped is history the
 * daily pass owns. Same number of requests, far smaller responses, and it fits
 * an hourly schedule with room to spare.
 *
 * Three days rather than one so a booking edited or cancelled shortly after it
 * was made is corrected on the next cycle, not the next evening.
 *
 * appointment-ledger follows, because it is what turns b2c appointments into
 * the booked / showed / no-show counts the tracker and the client portal read.
 * Without it a new booking would be in the database and not on the page.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { authorisedCron } from '@/lib/cron';
import { findSync } from '@/lib/sync/registry';
import { runSync, type SyncResult } from '@/lib/sync/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LIVE_WINDOW_DAYS = 3;

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

  const appointments = findSync('crm-appointments');
  const ledger = findSync('appointment-ledger');
  if (!appointments || !ledger) {
    return NextResponse.json(
      { error: 'crm-appointments or appointment-ledger missing from the sync registry' },
      { status: 500 },
    );
  }

  const startedAt = Date.now();
  const results: Array<{ name: string; result: SyncResult }> = [];

  results.push({
    name: appointments.name,
    result: await runSync(appointments.name, 'cron', appointments.run, {
      windowDays: LIVE_WINDOW_DAYS,
    }),
  });

  // Only derive if there is time left; the ledger takes about a second, so
  // this guard exists for the day crm-appointments does not.
  if (Date.now() - startedAt < 270_000) {
    results.push({
      name: ledger.name,
      result: await runSync(ledger.name, 'cron', ledger.run),
    });
  }

  const failed = results.filter((entry) => entry.result.status === 'error');

  return NextResponse.json(
    {
      cycleMs: Date.now() - startedAt,
      windowDays: LIVE_WINDOW_DAYS,
      syncs: results.map((entry) => ({
        name: entry.name,
        status: entry.result.status,
        durationMs: entry.result.durationMs,
        counts: entry.result.counts,
        errorCount: entry.result.errors.length,
      })),
    },
    { status: failed.length > 0 ? 500 : 200 },
  );
}

/** POST is allowed so an admin can trigger it by hand. */
export const POST = GET;
