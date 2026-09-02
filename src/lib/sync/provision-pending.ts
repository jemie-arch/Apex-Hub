/**
 * Finishes any onboarding submission that has not got a working sub-account yet.
 *
 * Provisioning already runs when the form is submitted, so this exists for the
 * case that actually happens: the call was refused for a reason outside the form
 * — a missing scope, a stale token, GoHighLevel having a bad minute — and the fix
 * lands later. Without this, every one of those needs somebody to remember to go
 * and press a button.
 *
 * It runs on the daily schedule and can be run by hand from settings, so a
 * granted scope repairs the backlog on its own rather than being a click nobody
 * makes.
 *
 * Safe to run repeatedly. A submission whose account exists is configured rather
 * than duplicated, and a submission already finished is skipped entirely.
 */
import {
  adaptGhlOnboarding,
  GHL_ONBOARDING_FORM_KEY,
  HUB_ONBOARDING_FORM_KEY,
} from '@/lib/onboarding/ghl-form';
import { provisionFromSubmission } from '@/lib/onboarding/provision';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/**
 * Both intakes, because a practice can arrive through either.
 *
 * This used to read only the Hub's own form. That single filter is why 141 real
 * submissions never provisioned: they came in on the GoHighLevel form and the
 * automation could not see them. lib/onboarding/ghl-form translates that shape.
 */
const ONBOARDING_FORM_KEYS = [
  HUB_ONBOARDING_FORM_KEY,
  GHL_ONBOARDING_FORM_KEY,
] as const;

/**
 * Only auto-provision submissions from here onwards.
 *
 * Widening the form filter without this would queue a sub-account for every
 * unprovisioned submission ever received — around 141 of them, most for
 * practices that have had live GoHighLevel accounts for months. Creating a
 * second account for a running practice is expensive to undo and confusing to
 * everyone who touches it afterwards.
 *
 * So automation applies forward and history stays a human decision: every older
 * submission is still provisionable by hand from the Onboarding page, which is
 * where somebody can see which practice it is before pressing the button.
 */
const AUTO_PROVISION_FROM = new Date(Date.UTC(2026, 8, 1)).toISOString();

/**
 * Submissions attempted per run.
 *
 * Each is two or three API calls, and a backlog of fifty would outlast the
 * function. The rest are picked up on the next run, and the shortfall is
 * reported rather than looking like an empty queue.
 */
const BATCH = 10;

export async function syncProvisionPending(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  const [submissions, runs, placed] = await Promise.all([
    db
      .from('form_submissions')
      .select('id, clinic_name, payload, client_group_id, submitted_at, form_key')
      .in('form_key', ONBOARDING_FORM_KEYS)
      .eq('is_test', false)
      .gte('submitted_at', AUTO_PROVISION_FROM)
      .order('submitted_at', { ascending: true })
      .limit(200),
    db
      .from('provisioning_runs')
      .select('submission_id, status, crm_location_id')
      .order('created_at', { ascending: false })
      .limit(500),
    /*
     * Groups that already have a sub-account, under any of their locations.
     *
     * The second rail. A submission from a practice that is already live in
     * GoHighLevel must not create a second account — that happens when an
     * existing client fills the onboarding form again, which is a normal thing
     * for a practice to do and must not be destructive.
     */
    db.from('clients').select('group_id').not('crm_location_id', 'is', null),
  ]);

  if (submissions.error) throw submissions.error;
  if (runs.error) throw runs.error;
  if (placed.error) throw placed.error;

  const alreadyLive = new Set(
    (placed.data ?? []).map((row) => row.group_id).filter(Boolean) as string[],
  );

  /*
   * The best outcome each submission has reached, and the account id if any
   * attempt got that far.
   *
   * Read across every attempt rather than only the newest: a later failure does
   * not un-create a sub-account, and losing the id would mean the next run built
   * a second one for the same practice.
   */
  const done = new Set<string>();
  const locationOf = new Map<string, string>();

  for (const run of runs.data ?? []) {
    if (!run.submission_id) continue;
    if (run.status === 'values_written') done.add(run.submission_id);
    if (run.crm_location_id && !locationOf.has(run.submission_id)) {
      locationOf.set(run.submission_id, run.crm_location_id);
    }
  }

  const unfinished = (submissions.data ?? []).filter((row) => !done.has(row.id));

  /*
   * Skipped rather than attempted, and counted so the skip is visible. A silent
   * filter here would look identical to an empty queue, which is exactly how the
   * previous form-key filter hid 141 submissions.
   */
  const alreadyHasAccount = unfinished.filter(
    (row) => row.client_group_id && alreadyLive.has(row.client_group_id),
  ).length;

  const eligible = unfinished.filter(
    (row) => !(row.client_group_id && alreadyLive.has(row.client_group_id)),
  );

  const pending = eligible.filter((row) => (row.clinic_name ?? '').trim() !== '');
  const nameless = eligible.length - pending.length;

  ctx.note('submissions_seen', submissions.data?.length ?? 0);
  ctx.note('already_provisioned', done.size);
  ctx.note('pending', pending.length);
  if (alreadyHasAccount > 0) {
    ctx.note('skipped_group_already_live', alreadyHasAccount);
  }
  if (nameless > 0) {
    // Not a failure to retry — there is nothing to name the sub-account.
    ctx.note('pending_but_no_clinic_name', nameless);
  }

  if (pending.length === 0) {
    ctx.log('Every onboarding submission has a configured sub-account.');
    return;
  }

  let succeeded = 0;

  for (const submission of pending.slice(0, BATCH)) {
    const outcome = await provisionFromSubmission({
      submissionId: submission.id,
      clientGroupId: submission.client_group_id,
      clinicName: submission.clinic_name ?? '',
      /*
       * The Hub's form already speaks snake_case; the GoHighLevel one speaks
       * question text. Translated here rather than in provisionFromSubmission so
       * that function keeps one input shape and stays testable without knowing
       * which form a practice happened to fill in.
       */
      answers:
        submission.form_key === GHL_ONBOARDING_FORM_KEY
          ? adaptGhlOnboarding(
              (submission.payload ?? {}) as Record<string, unknown>,
            )
          : ((submission.payload ?? {}) as Record<string, string>),
      // Configure the account a previous attempt made, rather than a second one.
      existingLocationId: locationOf.get(submission.id) ?? null,
    });

    ctx.counts.read += 1;

    if (outcome.status === 'values_written') {
      succeeded += 1;
      ctx.counts.created += 1;
    } else {
      // Recorded on the run row too; surfaced here so the sync reports partial
      // rather than reading as a clean pass that changed nothing.
      ctx.recordError(
        `${submission.clinic_name}: ${outcome.message}`,
        { submissionId: submission.id, status: outcome.status },
      );
    }
  }

  if (pending.length > BATCH) {
    ctx.note('deferred_to_next_run', pending.length - BATCH);
  }

  ctx.log(
    `${succeeded} of ${Math.min(pending.length, BATCH)} attempted submission(s) ` +
      'now have a configured sub-account.',
  );
}
