/**
 * Turning an onboarding submission into a working sub-account.
 *
 * The order matters and is the whole design: the submission is already saved
 * before this runs, and this records what it did in provisioning_runs. So a
 * refused API call costs a retry, never the practice's answers.
 *
 * Retrying is safe. If a previous run got as far as creating the sub-account, its
 * id is on that row and this configures the existing account rather than making a
 * second one — the failure mode nobody notices until an agency has two Lightning
 * Orthodontics.
 */
import {
  CONSTANT_CUSTOM_VALUES,
  ONBOARDING_SNAPSHOT_ID,
  ONBOARDING_VALUE_MAP,
  derivedCustomValues,
  nameCustomValues,
} from '@/config/provisioning';
import {
  GhlWriteError,
  createSubAccount,
  setCustomValues,
} from '@/lib/integrations/ghl-provision';
import { serviceClient } from '@/lib/supabase/service';

export interface ProvisionOutcome {
  ok: boolean;
  status: 'created' | 'values_written' | 'partial' | 'failed';
  message: string;
  locationId?: string;
  written?: string[];
  missing?: string[];
}

/** Answers keyed by the form field names in config/public-forms.ts. */
export type Answers = Record<string, string | undefined>;

function pick(answers: Answers, field: string): string | undefined {
  const value = answers[field];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/**
 * The custom values this submission can fill.
 *
 * Blank answers are dropped rather than written as empty strings: the snapshot
 * ships sensible defaults, and overwriting one with "" is worse than leaving it.
 */
export function valuesFor(clinicName: string, answers: Answers): Record<string, string> {
  const values: Record<string, string> = {
    ...CONSTANT_CUSTOM_VALUES,
    ...nameCustomValues(clinicName),
  };

  for (const [field, customValueName] of Object.entries(ONBOARDING_VALUE_MAP)) {
    const answer = pick(answers, field);
    if (answer !== undefined) values[customValueName] = answer;
  }

  return values;
}

export async function provisionFromSubmission(input: {
  submissionId: string | null;
  clientGroupId: string | null;
  clinicName: string;
  answers: Answers;
  startedBy?: string | null;
  /** From a previous attempt. Present means configure, do not create. */
  existingLocationId?: string | null;
}): Promise<ProvisionOutcome> {
  const db = serviceClient();
  const clinicName = input.clinicName.trim();

  if (clinicName === '') {
    return {
      ok: false,
      status: 'failed',
      message: 'No clinic name on the submission, and a sub-account needs one.',
    };
  }

  async function record(
    status: ProvisionOutcome['status'],
    extra: {
      locationId?: string | null;
      written?: string[];
      missing?: string[];
      failed?: Array<{ name: string; reason: string }>;
      error?: string;
      scopeProblem?: boolean;
    },
  ) {
    await db.from('provisioning_runs').insert({
      submission_id: input.submissionId,
      client_group_id: input.clientGroupId,
      clinic_name: clinicName,
      snapshot_id: ONBOARDING_SNAPSHOT_ID,
      status,
      crm_location_id: extra.locationId ?? null,
      values_written: extra.written ?? [],
      values_missing: extra.missing ?? [],
      values_failed: extra.failed ?? [],
      error: extra.error ?? null,
      scope_problem: extra.scopeProblem ?? false,
      started_by: input.startedBy ?? null,
    });
  }

  // ---- 1. the sub-account ------------------------------------------------
  let locationId = input.existingLocationId ?? null;

  if (locationId === null) {
    try {
      const created = await createSubAccount({
        name: clinicName,
        snapshotId: ONBOARDING_SNAPSHOT_ID,
        timezone: pick(input.answers, 'timezone'),
        website: pick(input.answers, 'website'),
        phone: pick(input.answers, 'phone'),
        email: pick(input.answers, 'doctor_email'),
      });
      locationId = created.locationId;
    } catch (error) {
      const scope = error instanceof GhlWriteError && error.isScopeProblem;
      const detail = error instanceof Error ? error.message : String(error);

      await record('failed', {
        error: detail,
        scopeProblem: scope,
      });

      return {
        ok: false,
        status: 'failed',
        message: scope
          ? 'GoHighLevel refused the request as unauthorised. The connected app ' +
            'needs the locations.write scope — re-authorise it in agency ' +
            'settings, then press Retry. The submission is saved; nothing is lost. ' +
            `(${detail})`
          : `Could not create the sub-account: ${detail}`,
      };
    }
  }

  // ---- 2. the custom values ----------------------------------------------
  const values = {
    ...valuesFor(clinicName, input.answers),
    ...derivedCustomValues(locationId),
  };

  try {
    // Passed null so the AGENCY token is used: a location token for an account
    // created seconds ago has not been minted yet.
    const outcome = await setCustomValues(null, locationId, values);

    const status: ProvisionOutcome['status'] =
      outcome.failed.length > 0 || outcome.missing.length > 0
        ? 'partial'
        : 'values_written';

    await record(status, {
      locationId,
      written: outcome.written,
      missing: outcome.missing,
      failed: outcome.failed,
    });

    return {
      ok: true,
      status,
      locationId,
      written: outcome.written,
      missing: outcome.missing,
      message:
        `Sub-account ready with ${outcome.written.length} value(s) filled.` +
        (outcome.missing.length > 0
          ? ` ${outcome.missing.length} had no matching field in the snapshot: ${outcome.missing.join(', ')}.`
          : '') +
        (outcome.failed.length > 0
          ? ` ${outcome.failed.length} were refused.`
          : ''),
    };
  } catch (error) {
    const scope = error instanceof GhlWriteError && error.isScopeProblem;
    const detail = error instanceof Error ? error.message : String(error);

    // The sub-account exists. Recording its id is what makes the retry configure
    // it rather than create a twin.
    await record('created', {
      locationId,
      error: detail,
      scopeProblem: scope,
    });

    return {
      ok: false,
      status: 'created',
      locationId,
      message:
        `The sub-account was created (${locationId}) but its custom values were ` +
        `not written: ${detail}. Retry configures that same account rather than ` +
        'creating another.',
    };
  }
}
