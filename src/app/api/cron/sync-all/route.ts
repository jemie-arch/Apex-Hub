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
 * Order matters, and so does what is missing from it.
 *
 * crm-appointments is NOT here, and that is the point. It has its own cron entry
 * in vercel.json at 18:00, and it takes 136 to 183 seconds — most of the 240s
 * start budget below. Sitting fourth in this cycle it did exactly what this
 * route was written to prevent: everything after it ran out of time and never
 * started. The evidence was unambiguous once anyone looked at sync_runs —
 * crm-deals, crm-calls and stripe-charges had never once run from cron, which is
 * why the b2b pipeline was empty, and why the only ad spend in the database came
 * from a spreadsheet import rather than from Windsor.
 *
 * So the expensive sync keeps its own schedule and this cycle keeps the seven
 * that fit. Duplicating it here bought nothing anyway: the same work, twice a
 * day, at the cost of everything downstream.
 *
 * crm-clients first: it creates the client rows every other sync joins to. A new
 * sub-account added in GoHighLevel this morning is invisible to the rest until
 * its client row exists, and doing it in the other order delays that by a day.
 *
 * crm-calls last: it is the most expensive per record — two requests per
 * conversation — and the call-centre leaderboard tolerates a day's lag better
 * than money or attribution does. If the budget runs out, this is the right
 * thing to lose.
 */
const ORDER = [
  'crm-clients',
  // After clients so the agency token and location rows exist, and early enough
  // that a scope granted this morning repairs the backlog today rather than
  // waiting on somebody noticing a button.
  'provision-pending',
  /*
   * The three sheet reads, and the reason they are ahead of the ledger.
   *
   * All three were held out of this cycle while GOOGLE_SERVICE_ACCOUNT_KEY was
   * unset, on the rule this file keeps everywhere: a sync that cannot succeed
   * must not run nightly, because a cycle that always reports a failure is how
   * a real failure stops being noticed.
   *
   * That condition is gone. On 7 September the key was accepted and both
   * sheets were read — fulfilment-tracker returned all fourteen of the
   * tracker's headings, and commission-inputs returned the pay scheme and
   * updated it. So the rule now points the other way, and leaving them out
   * means they only ever run when somebody presses a button.
   *
   * Nothing had ever pressed it for booking-sheet. It is the sheet the live
   * pay calculation actually reads and it had never run once, which is the
   * whole argument for scheduling rather than remembering. It needs no new
   * configuration: it reads COMMISSION_INPUTS_SHEET_ID, the same workbook
   * commission-inputs just succeeded against, a different tab of it.
   *
   * fulfilment-tracker goes BEFORE appointment-ledger and that placement is
   * load-bearing — the ledger reads tracker_appointments, so importing after
   * it would reconcile today's appointments against yesterday's sheet and
   * report the difference as exceptions.
   *
   * Cost is small enough not to threaten the 240s start budget: the two
   * measured runs took 2.2s and 3.2s against a cycle whose slowest member,
   * crm-calls, takes 45s.
   */
  'fulfilment-tracker',
  /*
   * The leads tab, and why it matters more than its size suggests.
   *
   * tracker_leads was loaded once, on 22 August 2026, and nothing has ever
   * written it — only the freshness alert in appointment-ledger, reporting it
   * stale to nobody. The tracker takes leads_best as
   * greatest(leads_windsor, leads_tracker), and Windsor sees nothing for 30 of
   * 35 accounts, so the sheet IS the lead count.
   *
   * When it went stale the count collapsed and every figure divided by it went
   * with it: 383 leads and a $35 CPL for the week of 10 August, 1 lead and an
   * $8,844 CPL for the week of 31 August, on unchanged spend.
   *
   * Ahead of appointment-ledger for the same reason as the tab above.
   */
  'fulfilment-leads',
  'booking-sheet',
  'commission-inputs',
  /*
   * 'onboarding-calls' is deliberately NOT here, for the same reason as
   * 'scenario-audit' and 'payout-hours' below.
   *
   * It reads the ADM Client Onboarding sub-account looking for a calendar named
   * like an onboarding or launch call, and there is not one. On 2 September the
   * sub-account held exactly one calendar: "Joshua Jung's Personal Calendar".
   * So the sync cannot succeed, has never read a row, and reported partial every
   * night — which is how a cycle teaches everyone to ignore its failures.
   *
   * Not fixed by widening the pattern, and that is the point. It identifies a
   * call by calendar rather than by title on purpose, because a title is typed
   * by whoever booked it and drifts. Matching a personal calendar would file
   * every meeting that person books as an onboarding call, which is worse than
   * knowing nothing.
   *
   * Whoever knows where these calls are actually booked can settle it in a
   * minute: if they are in a different sub-account, change
   * ONBOARDING_LOCATION_ID and put this back; if they are not in GoHighLevel at
   * all, delete the sync. It stays registered either way, so it still runs from
   * settings and the CLI for anybody testing that.
   */
  'crm-deals',
  'windsor-ads',
  'stripe-charges',
  // Reads what everything above writes, so it goes after them or it
  // reconciles yesterday's picture and reports today's exceptions against it.
  'appointment-ledger',
  'crm-calls',
  /*
   * The CRM lead feed, and why it is last.
   *
   * It is the reference count for every lead figure the Hub shows, so it
   * matters — but it spends one or two HTTP requests per practice against a
   * rate-limited API and nothing else in this cycle reads what it writes. The
   * tail is where a slow sync costs least, and if the 240s budget runs out
   * this is the right thing to lose: a lead's dateAdded never changes, so
   * tomorrow's run picks up whatever tonight's missed.
   *
   * First scheduled run is 8 September 2026. It has credentials — crm-calls
   * uses the same tokens — but /contacts/ has never been read, so expect the
   * key-name report in its notes to correct the field mapping.
   */
  'crm-leads',
  /*
   * The AI call summaries, last because they depend on nothing here and cost
   * one sheet read.
   *
   * It imports what Make scenario 5560467 already produced — transcript,
   * summary and sales coaching — and, more importantly, the caller name that
   * finally attributes a call to a person. Nothing in this sync transcribes
   * anything, so it costs no AI spend per call.
   *
   * Expect it to report the tab empty until that scenario is re-enabled: it
   * ran on 28 August 2026, filled Make's organisation dead-letter queue, and
   * was switched off. The empty tab is recorded as an error on purpose, so the
   * cause stays visible rather than looking like a quiet day.
   */
  'call-summaries',
  /*
   * The RAW DATA tab, beside the summaries because it is the same workbook and
   * the same Make scenario — but it earns its place for a different reason.
   *
   * This is the tab the pay dashboard's J2 counts:
   *
   *   COUNTIFS('RAW DATA'!C:C, <agent>, 'RAW DATA'!N:N, "*Booked*", <dates>)
   *
   * which is why agent pay would not reconcile against booking-sheet above.
   * The Hub was counting the BOOKING SHEET tab and the dashboard counts this
   * one; they disagreed in opposite directions because they were answering
   * different questions, not because either was miscounting.
   *
   * AFTER call-summaries deliberately, so the roster resolution runs first and
   * a name added there attributes these rows on the same cycle rather than the
   * next one.
   *
   * Cheap: one sheet read, no AI, no per-call cost, and the widest column is a
   * phone number.
   */
  'raw-call-rows',
  /*
   * 'fulfilment-tracker' moved up, above appointment-ledger. It used to sit
   * here with a note explaining that the Google credentials were unset and
   * what to do when they arrived. They arrived; that was done. Left as a
   * marker only so the instruction is not read as still outstanding.
   */
  /*
   * 'scenario-audit' is deliberately NOT here yet, for the same reason as
   * payout-hours below: MAKE_TOKEN is not set, so including it would guarantee
   * a failed sync every night, and a cycle that always reports a failure is how
   * a real failure stops being noticed.
   *
   * It is registered, so it runs from settings and the CLI the moment the token
   * exists. Add it here at that point — near the end, since it reads nothing
   * this cycle writes and it spends one HTTP request per scenario against a
   * rate-limited API, which is cost the tail can absorb and the head cannot.
   */
  /*
   * 'payout-hours' is deliberately NOT here yet.
   *
   * HUBSTAFF_TOKEN is not set, so adding it would guarantee a failed sync every
   * night — and a cycle that always reports a failure is how a real failure
   * stops being noticed. It is registered, so it runs from settings and the CLI
   * the moment the token exists; add it here at that point, not before.
   *
   * When it does go in, it belongs at the end. It reads paid_leave_hours() and
   * nothing else in this list writes time-off requests, so it has no dependency
   * on the syncs above — but it does call an external API, and the cycle has a
   * 240-second start budget against a 300-second limit. The tail is where a slow
   * sync costs least.
   */
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
