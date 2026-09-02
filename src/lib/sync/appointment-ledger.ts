/**
 * Keeping the appointment ledger current.
 *
 * The ledger is the only place one row equals one appointment. It was backfilled
 * once from both feeds, and a backfill that nothing repeats is a snapshot that
 * rots — the same failure as client_groups.status, which was written when a row
 * was created and never again, and read as 'onboarding' for 64 of 73 businesses
 * for months.
 *
 * So this runs after the feeds that supply it. rebuild_appointment_ledger() is
 * idempotent by construction: identity comes from each feed's own key, so a
 * second run updates rather than forking. Two consecutive runs on the live data
 * both land on 1,304 rows and the second bills nothing.
 *
 * Ordering matters and is the reason this sits last in the cycle. It reads
 * appointments, tracker_appointments and billing_charges, so it must run after
 * crm-appointments and stripe-charges or it reconciles yesterday's picture and
 * reports today's exceptions against it.
 */
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

interface RebuildResult {
  rows_total: number;
  from_crm: number;
  from_tracker: number;
  matched_both: number;
  reschedule_links: number;
  billed_rows: number;
}

export async function syncAppointmentLedger(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  await reportTrackerFreshness(ctx, db);

  /*
   * First, retire tracker-only rows that a CRM appointment has caught up with.
   *
   * The rebuild matches a tracker row to a CRM appointment and stamps the
   * tracker key onto the CRM row, without removing the tracker-only row it
   * supersedes — so both would carry the same key and the unique index aborts
   * the whole rebuild. It only bites the first time a practice crosses from
   * "tracker rows, no CRM appointments" to "both", which is why it sat dormant
   * until Kind Dental's consultation calendar stopped being excluded.
   *
   * Separate from the rebuild on purpose: the superseded rows can be found
   * without any of that function's internals, so this stays reviewable and 177
   * lines of billing logic stay untouched. See migration 0030.
   */
  const superseded = await db.rpc('merge_superseded_tracker_ledger_rows');
  if (superseded.error) throw superseded.error;
  if ((superseded.data ?? 0) > 0) {
    ctx.note('superseded_tracker_rows', superseded.data as number);
  }

  const rebuilt = await db.rpc('rebuild_appointment_ledger');
  if (rebuilt.error) throw rebuilt.error;

  const result = (rebuilt.data ?? {}) as Partial<RebuildResult>;

  ctx.counts.read = result.rows_total ?? 0;
  ctx.counts.updated = result.billed_rows ?? 0;

  ctx.note('rows_total', result.rows_total ?? 0);
  ctx.note('from_crm', result.from_crm ?? 0);
  ctx.note('from_tracker', result.from_tracker ?? 0);
  /*
   * The reconciliation number. A row carrying both a calendar id and a tracker
   * row is one appointment the two feeds agree on; the gap between this and
   * either total is the disagreement the ledger exists to surface.
   */
  ctx.note('matched_both_feeds', result.matched_both ?? 0);
  ctx.note('reschedule_links', result.reschedule_links ?? 0);

  /*
   * What somebody has to act on, straight from the view so this cannot drift
   * from what the screen shows.
   *
   * Severity 1 and 2 are recorded as errors rather than logged: money taken
   * without a recorded show, and an appointment that vanished from the CRM while
   * still open, are both things that should make the run report 'partial' and
   * fire the alert. Everything below that is a backlog, and a backlog reported
   * as a fault every night is how an alert becomes wallpaper.
   */
  const exceptions = await db
    .from('appointment_exceptions')
    .select('exception, severity');
  if (exceptions.error) throw exceptions.error;

  const byException = new Map<string, number>();
  let urgent = 0;
  /*
   * Counted apart because it is the only urgent category that can still be
   * prevented. The other two describe something that has already gone wrong;
   * this one is a booking whose appointment has not happened yet, so writing
   * the tracker row today stops it becoming unbillable.
   */
  let preventable = 0;

  for (const row of exceptions.data ?? []) {
    const label = row.exception ?? 'unlabelled';
    byException.set(label, (byException.get(label) ?? 0) + 1);
    if ((row.severity ?? 9) <= 2) urgent += 1;
    if (label.includes('still ahead')) preventable += 1;
  }

  if (byException.size > 0) {
    ctx.note(
      'exceptions',
      Object.fromEntries([...byException.entries()].sort((a, b) => b[1] - a[1])),
    );
  }

  /*
   * The preventable count leads, because it is the only part of this anybody can
   * act on today. Marlene Gonzalez at Ultra Smiles was booked on 20 August for
   * the 25th with no tracker row, and this alert said nothing for four days
   * because her appointment had not happened yet — she was found by hand, the
   * day before, by reading Make execution logs. The view now flags that case at
   * severity 2 and this is where it surfaces.
   */
  if (preventable > 0) {
    ctx.recordError(
      `${preventable} appointment(s) are booked in the CRM with no tracker row ` +
        'and have NOT happened yet. Writing the row before the patient arrives ' +
        'is the only thing that keeps them billable — after the appointment ' +
        'there is nothing to record an outcome against.',
      { preventable },
    );
  }

  const alreadyWrong = urgent - preventable;
  if (alreadyWrong > 0) {
    ctx.recordError(
      `${alreadyWrong} appointment(s) are either billed without a recorded show ` +
        'or vanished from the CRM while still open. Both mean money and ' +
        'evidence disagree — see the appointment_exceptions view.',
      { urgent: alreadyWrong },
    );
  }

  const overdue = byException.get('outcome overdue') ?? 0;
  if (overdue > 0) {
    ctx.log(
      `${overdue} appointment(s) have no outcome past their deadline. Nobody ` +
        'filled the survey and nobody ran the no-show check.',
    );
  }

  /*
   * The other direction: charges that cannot be tied to an appointment.
   *
   * appointment_exceptions looks outward from the ledger, so it can only see
   * problems that have a row. A charge naming a patient who exists in neither
   * feed has nothing to hang off and was invisible to it — which is how $9,808
   * across 38 charge lines sat unnoticed while the same reconciliation reported
   * unbilled work in the other direction.
   *
   * This is the direction that costs money rather than delays it. Unbilled work
   * is revenue not yet taken; a charge with no appointment behind it is revenue
   * taken with no evidence, and it is the one a client can dispute.
   */
  const chargeExceptions = await db
    .from('charge_exceptions')
    .select('exception, severity, line_amount_cents');
  if (chargeExceptions.error) throw chargeExceptions.error;

  const chargeRows = chargeExceptions.data ?? [];

  if (chargeRows.length > 0) {
    const byCharge = new Map<string, number>();
    let unevidenced = 0;
    let unevidencedCents = 0;

    for (const row of chargeRows) {
      const label = row.exception ?? 'unlabelled';
      byCharge.set(label, (byCharge.get(label) ?? 0) + 1);
      if ((row.severity ?? 9) <= 1) {
        unevidenced += 1;
        unevidencedCents += row.line_amount_cents ?? 0;
      }
    }

    ctx.note(
      'charge_exceptions',
      Object.fromEntries([...byCharge.entries()].sort((a, b) => b[1] - a[1])),
    );

    if (unevidenced > 0) {
      ctx.recordError(
        `${unevidenced} charge line(s) totalling ` +
          `$${(unevidencedCents / 100).toFixed(2)} cannot be tied to an ` +
          'appointment in either feed. Money taken with no record behind it is ' +
          'the disputable kind — see the charge_exceptions view.',
        { lines: unevidenced, cents: unevidencedCents },
      );
    }
  }

  await reportUnbilledBacklog(ctx, db);
}

/**
 * How old the tracker feed is, said out loud every night.
 *
 * The header of this file warns that "a backfill that nothing repeats is a
 * snapshot that rots". tracker_appointments is that snapshot. It was loaded
 * once, on 22 August 2026 — one distinct import date across all 1,281 rows —
 * and nothing in this repository writes to it. Every reference is a read.
 *
 * That was tolerable while the tracker only fed reconciliation, because a stale
 * feed there produces a visible disagreement with the CRM. It stopped being
 * tolerable when migration 0031 loaded the tracker's outcomes into
 * appointments, because portal/[token] renders those as "Started treatment" to
 * the practice. A frozen feed now means a client-facing number that silently
 * stops growing while consultations keep happening — the reader cannot tell
 * "nobody started treatment" from "nobody has re-imported the sheet".
 *
 * Deliberately not an error until it is old enough to be one. This file already
 * argues that "a backlog reported as a fault every night is how an alert
 * becomes wallpaper", and re-importing is manual today, so a nightly failure
 * would train everyone to ignore the run. The age is always recorded, seven
 * days logs, thirty days is a genuine fault: past a month the ledger is
 * reconciling against a picture nobody recognises.
 *
 * The durable fix is not a fresher import. It is the practices answering in
 * their portal, which is the one source that updates itself — the tracker
 * backfill was always a bridge to that, not a replacement for it.
 */
async function reportTrackerFreshness(
  ctx: SyncContext,
  db: ReturnType<typeof serviceClient>,
): Promise<void> {
  const latest = await db
    .from('tracker_appointments')
    .select('imported_at')
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;

  // No rows at all is a different condition, and not this function's business.
  if (!latest.data?.imported_at) return;

  const importedAt = new Date(latest.data.imported_at);
  const ageDays = Math.floor(
    (Date.now() - importedAt.getTime()) / 86_400_000,
  );

  ctx.note('tracker_last_imported', {
    on: importedAt.toISOString().slice(0, 10),
    age_days: ageDays,
  });

  if (ageDays >= 30) {
    ctx.recordError(
      `The tracker feed was last imported ${ageDays} days ago. Every outcome ` +
        'the ledger and the client portal read from it is at least that old, ' +
        'and consultations since then have no outcome at all. Nothing in the ' +
        'Hub writes this table — it has to be re-imported by hand, or the ' +
        'practices have to start answering in their portal.',
      { age_days: ageDays },
    );
    return;
  }

  if (ageDays >= 7) {
    ctx.log(
      `The tracker feed is ${ageDays} days old. Consultations since then have ` +
        'no recorded outcome, including on the practice-facing portal.',
    );
  }
}

/**
 * What the delivered-but-uninvoiced work is worth, and how old it is.
 *
 * The count alone was already on screen. The value was not, because until Stripe
 * was in the database there was no way to price an appointment — the PPS audit
 * concluded the rate was unrecoverable, and from Make and GoHighLevel alone it
 * was. It is recoverable from what was actually charged.
 *
 * Age is the part that makes this a finding rather than a number. A show from
 * last week sitting unbilled is billing in progress. A show from December is
 * not, and one total covering both hides it: when this was written 28 of 489
 * unbilled shows were inside two weeks and 116 were over six months old.
 *
 * Only the aged portion is recorded as an error. Alerting on the whole backlog
 * would fire every night forever, because there is always work mid-billing.
 */
async function reportUnbilledBacklog(
  ctx: SyncContext,
  db: ReturnType<typeof serviceClient>,
): Promise<void> {
  const backlog = await db
    .from('unbilled_backlog')
    .select('est_value_cents, is_aged, age_band, rate_basis');
  if (backlog.error) throw backlog.error;

  const rows = backlog.data ?? [];
  if (rows.length === 0) return;

  const byBand = new Map<string, number>();
  let agedRows = 0;
  let agedCents = 0;
  let totalCents = 0;
  let assumedRows = 0;

  for (const row of rows) {
    const band = row.age_band ?? 'unbanded';
    byBand.set(band, (byBand.get(band) ?? 0) + 1);
    totalCents += row.est_value_cents ?? 0;
    if (row.rate_basis === 'fleet assumption') assumedRows += 1;
    if (row.is_aged) {
      agedRows += 1;
      agedCents += row.est_value_cents ?? 0;
    }
  }

  ctx.note('unbilled_backlog', {
    rows: rows.length,
    estimated_cents: totalCents,
    aged_rows: agedRows,
    aged_cents: agedCents,
    /*
     * Surfaced because it bounds how much the figure can be trusted. A practice
     * with no charge history has no rate of its own, so its rows are priced from
     * the fleet mode — a real estimate, but not a measured one.
     */
    priced_by_assumption: assumedRows,
    by_age: Object.fromEntries([...byBand.entries()]),
  });

  if (agedRows > 0) {
    ctx.recordError(
      `${agedRows} delivered consultation(s) worth an estimated ` +
        `$${(agedCents / 100).toFixed(2)} are over 30 days old with no ` +
        'matching charge. This is an estimate of exposure, not confirmed ' +
        'receivable — see the unbilled_backlog view for the per-practice split.',
      { rows: agedRows, cents: agedCents },
    );
  }
}
