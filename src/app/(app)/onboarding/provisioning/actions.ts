'use server';

/**
 * Retrying a sub-account build.
 *
 * The reason this exists rather than being a nice-to-have: the connected
 * GoHighLevel app may not hold locations.write yet, so the first attempt for any
 * practice can fail on authorisation. Without a retry, fixing the scope would
 * mean asking the practice to fill the form again.
 */
import { revalidatePath } from 'next/cache';

import { provisionFromSubmission } from '@/lib/onboarding/provision';
import { requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export interface RetryResult {
  ok: boolean;
  message: string;
}

/**
 * Provisions an onboarding submission that has never been attempted.
 *
 * Needed because of a real gap the first live test found: the submission saved,
 * provisioning silently did not run, and with no attempt row there was nothing
 * for Retry to act on — the answers were stranded in a table with no button
 * anywhere that could use them.
 */
export async function provisionSubmission(input: {
  submissionId: string;
}): Promise<RetryResult> {
  const caller = await requireAdmin();
  const db = serviceClient();

  const submission = await db
    .from('form_submissions')
    .select('id, payload, clinic_name, client_group_id')
    .eq('id', input.submissionId)
    .maybeSingle();

  if (submission.error) return { ok: false, message: submission.error.message };
  if (!submission.data) return { ok: false, message: 'No such submission.' };

  const answers = (submission.data.payload ?? {}) as Record<string, string>;

  const outcome = await provisionFromSubmission({
    submissionId: submission.data.id,
    clientGroupId: submission.data.client_group_id,
    clinicName: submission.data.clinic_name ?? '',
    answers,
    startedBy: caller.id,
  });

  revalidatePath('/onboarding/provisioning');
  return { ok: outcome.ok, message: outcome.message };
}

export async function retryProvisioning(input: {
  runId: string;
}): Promise<RetryResult> {
  const caller = await requireAdmin();
  const db = serviceClient();

  const run = await db
    .from('provisioning_runs')
    .select('id, submission_id, client_group_id, clinic_name, crm_location_id')
    .eq('id', input.runId)
    .maybeSingle();

  if (run.error) return { ok: false, message: run.error.message };
  if (!run.data) return { ok: false, message: 'No such attempt.' };

  /*
   * The answers come from the submission, not from the failed run.
   *
   * A run records what happened, not what was asked for. Re-reading the
   * submission means a retry after somebody corrects an answer picks up the
   * correction, and a retry with no submission attached fails honestly rather
   * than building a sub-account out of nothing.
   */
  if (!run.data.submission_id) {
    return {
      ok: false,
      message:
        'This attempt has no submission attached, so there are no answers to ' +
        'build from. Provision from the form instead.',
    };
  }

  const submission = await db
    .from('form_submissions')
    .select('id, payload, clinic_name, client_group_id')
    .eq('id', run.data.submission_id)
    .maybeSingle();

  if (submission.error) return { ok: false, message: submission.error.message };
  if (!submission.data) {
    return { ok: false, message: 'The submission behind this attempt is gone.' };
  }

  const answers = (submission.data.payload ?? {}) as Record<string, string>;

  const outcome = await provisionFromSubmission({
    submissionId: submission.data.id,
    clientGroupId: submission.data.client_group_id ?? run.data.client_group_id,
    clinicName: submission.data.clinic_name ?? run.data.clinic_name,
    answers,
    startedBy: caller.id,
    // The crux of a safe retry: if the account already exists, configure it
    // rather than creating a second one for the same practice.
    existingLocationId: run.data.crm_location_id,
  });

  revalidatePath('/onboarding/provisioning');

  return { ok: outcome.ok, message: outcome.message };
}
