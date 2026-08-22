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
  writeAuth,
  type AuthKind,
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

/** A url-safe unique-ish slug. clients.slug and client_groups.slug are unique. */
function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // Suffixed because two practices can share a name and the column is unique;
  // a collision would fail the insert and read as a provisioning failure.
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base === '' ? 'practice' : base}-${suffix}`;
}

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

  /*
   * Which credential this attempt used, resolved up front so it is recorded even
   * when the very first call is refused. Without it, a 401 cannot be told apart
   * from 'the private token is not accepted for this endpoint', and those have
   * opposite fixes.
   */
  /** A non-fatal problem worth surfacing on the run row. */
  let ctxNote: string | null = null;
  let authKind: AuthKind | null = null;
  try {
    authKind = (await writeAuth()).kind;
  } catch {
    // No credential at all. The create call reports it properly.
  }

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
      auth_kind: authKind,
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

  /*
   * ---- 2. register it, so the token manager can mint for it ---------------
   *
   * Custom values are location scoped, so they need a token belonging to this
   * sub-account, and the token manager keys those off a clients row. Creating the
   * row here rather than waiting for the next crm-clients sync also means the
   * practice appears in the Hub straight away, which is what anybody would
   * expect after the form goes in.
   *
   * Idempotent on crm_location_id, so a retry finds the row instead of adding a
   * second one.
   */
  let clientId: string | null = null;

  try {
    const existing = await db
      .from('clients')
      .select('id')
      .eq('crm_location_id', locationId)
      .maybeSingle();

    if (existing.data) {
      clientId = existing.data.id;
    } else {
      // A group to hang it on. Reuse the one the submission was attributed to
      // when there is one, rather than creating a duplicate business.
      let groupId = input.clientGroupId;

      if (!groupId) {
        const group = await db
          .from('client_groups')
          .insert({
            name: clinicName,
            slug: slugify(clinicName),
            status: 'onboarding',
            contact_name: pick(input.answers, 'doctor_name') ?? null,
            contact_email: pick(input.answers, 'doctor_email') ?? null,
            contact_phone: pick(input.answers, 'phone') ?? null,
            website: pick(input.answers, 'website') ?? null,
          })
          .select('id')
          .maybeSingle();

        if (group.error) throw group.error;
        groupId = group.data?.id ?? null;
      }

      if (groupId) {
        const client = await db
          .from('clients')
          .insert({
            group_id: groupId,
            name: clinicName,
            slug: slugify(clinicName),
            crm_location_id: locationId,
            timezone: pick(input.answers, 'timezone') ?? 'UTC',
          })
          .select('id')
          .maybeSingle();

        if (client.error) throw client.error;
        clientId = client.data?.id ?? null;
      }
    }
  } catch (error) {
    // Not fatal. Without a row the custom values fall back to the agency
    // credential, which is worth trying rather than stopping here.
    ctxNote = error instanceof Error ? error.message : String(error);
  }

  // ---- 3. the custom values ----------------------------------------------
  const values = {
    ...valuesFor(clinicName, input.answers),
    ...derivedCustomValues(locationId),
  };

  try {
    const outcome = await setCustomValues(clientId, locationId, values);

    const status: ProvisionOutcome['status'] =
      outcome.failed.length > 0 || outcome.missing.length > 0
        ? 'partial'
        : 'values_written';

    await record(status, {
      locationId,
      written: outcome.written,
      missing: outcome.missing,
      failed: outcome.failed,
      // Recorded even on an otherwise clean run: if the clients row could not be
      // created, the sub-account exists and the practice is still missing from
      // the Hub, which nobody would notice from a green tick.
      error:
        ctxNote === null
          ? undefined
          : `Sub-account configured, but it could not be registered as a client: ${ctxNote}`,
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

    /*
     * The one failure worth naming, because it is structural rather than
     * transient and no amount of retrying fixes it.
     *
     * Custom values are location scoped, so they need a token belonging to the
     * new sub-account. That token is minted from the marketplace app's agency
     * install — and the install covers a fixed set of sub-accounts, chosen when
     * it was authorised. An account created seconds ago is not in that set, so
     * the mint is refused with "accessToken does not have access to following",
     * the fall-back to the agency credential is refused as out of scope, and the
     * message that reaches the screen is "not authorized for this scope" —
     * which reads as a missing permission and sends everyone to re-grant scopes
     * that were never missing.
     */
    const mintRefused = detail.includes('no location token could be minted');

    return {
      ok: false,
      status: 'created',
      locationId,
      message: mintRefused
        ? `The sub-account was created (${locationId}), but its custom values ` +
          'could not be written, and retrying will not change that. GoHighLevel ' +
          'would not issue a token for the new account: the marketplace app is ' +
          'installed on a fixed list of sub-accounts, and one created a moment ' +
          'ago is not on it. Custom values are location scoped, so the agency ' +
          'credential is refused there — which is why the underlying error says ' +
          '"not authorized for this scope" when no scope is missing. Re-install ' +
          'the app at agency level with every sub-account included, so accounts ' +
          'made from now on can mint their own token; then press Retry and the ' +
          `values go onto this same account. (${detail})`
        : `The sub-account was created (${locationId}) but its custom values were ` +
          `not written: ${detail}. Retry configures that same account rather than ` +
          'creating another.',
    };
  }
}
