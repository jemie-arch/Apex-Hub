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
import { provisionFromSubmission } from '@/lib/onboarding/provision';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

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

  const [submissions, runs] = await Promise.all([
    db
      .from('form_submissions')
      .select('id, clinic_name, payload, client_group_id, submitted_at')
      .eq('form_key', 'client_onboarding')
      .eq('is_test', false)
      .order('submitted_at', { ascending: true })
      .limit(200),
    db
      .from('provisioning_runs')
      .select('submission_id, status, crm_location_id')
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  if (submissions.error) throw submissions.error;
  if (runs.error) throw runs.error;

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

  const pending = (submissions.data ?? []).filter(
    (row) => !done.has(row.id) && (row.clinic_name ?? '').trim() !== '',
  );

  const nameless = (submissions.data ?? []).filter(
    (row) => !done.has(row.id) && (row.clinic_name ?? '').trim() === '',
  ).length;

  ctx.note('submissions_seen', submissions.data?.length ?? 0);
  ctx.note('already_provisioned', done.size);
  ctx.note('pending', pending.length);
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
      answers: (submission.payload ?? {}) as Record<string, string>,
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
