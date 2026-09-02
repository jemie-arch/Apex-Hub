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
  KNOWN_ABSENT_CUSTOM_VALUES,
  ONBOARDING_SNAPSHOT_ID,
  ONBOARDING_VALUE_MAP,
  derivedCustomValues,
  nameCustomValues,
} from '@/config/provisioning';
import {
  GhlWriteError,
  createLocationUser,
  createSubAccount,
  setCustomValues,
  splitName,
  writeAuth,
  type AuthKind,
} from '@/lib/integrations/ghl-provision';
import { serviceClient } from '@/lib/supabase/service';

export interface ProvisionOutcome {
  /** The sub-account had no custom values yet — the snapshot is still landing. */
  snapshotNotReady?: boolean;
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

  /*
   * Where confirmations go, when nobody said.
   *
   * The snapshot marks both of these as needing a value per client, and a
   * practice that leaves them blank does not mean "send confirmations nowhere"
   * — it means they assumed we already knew. The doctor email and the main
   * practice phone are the answers they would give if asked twice, and both are
   * already required or near-required above.
   *
   * Only used as a fallback: an explicit answer always wins, including one that
   * differs from the doctor email on purpose.
   */
  const fallbacks: ReadonlyArray<[string, string]> = [
    ['*Email To Send Confirmations To', 'doctor_email'],
    ['*Phone Number To Send Confirmations To', 'phone'],
  ];

  for (const [customValueName, sourceField] of fallbacks) {
    if (values[customValueName] !== undefined) continue;
    const fallback = pick(answers, sourceField);
    if (fallback !== undefined) values[customValueName] = fallback;
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
      userId?: string | null;
      userError?: string | null;
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
      ghl_user_id: extra.userId ?? null,
      user_error: extra.userError ?? null,
    });
  }

  // ---- 1. the sub-account ------------------------------------------------
  let locationId = input.existingLocationId ?? null;

  if (locationId === null) {
    try {
      /*
       * The sub-account's own profile, not just its merge fields.
       *
       * This used to send four fields and leave the rest of GoHighLevel's
       * business profile blank — no address, no city, no country — even though
       * createSubAccount accepts all of them and the onboarding form makes most
       * of them required. The first live route test made it obvious: an account
       * created with a name and nothing else behind it.
       *
       * The address is worth more than tidiness. It is what GoHighLevel uses on
       * the location record a practice sees, and the postal code is what several
       * of its own features key off. Collecting a required answer and then
       * dropping it is the same fault the Timezone custom value nearly had.
       *
       * firstName and lastName come from splitName rather than the raw answer,
       * so "Dr Casey Lindqvist, female" does not land as a first name.
       */
      const doctorName = pick(input.answers, 'doctor_name');
      const doctor = doctorName ? splitName(doctorName) : null;

      const created = await createSubAccount({
        name: clinicName,
        snapshotId: ONBOARDING_SNAPSHOT_ID,
        timezone: pick(input.answers, 'timezone'),
        website: pick(input.answers, 'website'),
        phone: pick(input.answers, 'phone'),
        email: pick(input.answers, 'doctor_email'),
        address: pick(input.answers, 'address'),
        city: pick(input.answers, 'city'),
        state: pick(input.answers, 'state'),
        postalCode: pick(input.answers, 'postal_code'),
        country: pick(input.answers, 'country'),
        ...(doctor === null
          ? {}
          : { firstName: doctor.firstName, lastName: doctor.lastName }),
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

  /*
   * ---- 3. the portal link -------------------------------------------------
   *
   * The practice's dashboard, which is what *Client Stats Sheet URL means: the
   * stat sheet and the portal are the same thing seen twice. Read from the group
   * rather than built from the clinic name, because the token is the credential
   * and guessing one would hand a practice somebody else's numbers.
   *
   * Absent when the group has no token or no base URL is configured. Then the
   * value is simply not written, which leaves the snapshot default in place
   * rather than writing a link that goes nowhere.
   */
  let portalUrl: string | undefined;

  const base = process.env['NEXT_PUBLIC_APP_URL']?.trim().replace(new RegExp('/+$'), '');

  if (base) {
    const groupForPortal = clientId
      ? await db
          .from('clients')
          .select('client_groups(portal_token, portal_enabled)')
          .eq('id', clientId)
          .maybeSingle()
      : null;

    const group = groupForPortal?.data?.client_groups as
      | { portal_token: string | null; portal_enabled: boolean | null }
      | null
      | undefined;

    if (group?.portal_token && group.portal_enabled) {
      portalUrl = `${base}/portal/${group.portal_token}`;
    }
  }

  // ---- 4. the custom values ----------------------------------------------
  const values = {
    ...valuesFor(clinicName, input.answers),
    ...derivedCustomValues(locationId, portalUrl),
  };

  try {
    const outcome = await setCustomValues(clientId, locationId, values);

    /*
     * A gap we already know about is not a degraded run.
     *
     * `missing` means "the snapshot has no field of this name". Three of those
     * are permanent and documented in UNAVAILABLE_CUSTOM_VALUES, so counting
     * them as a fault made 'partial' the outcome of every successful onboarding
     * — the first real one, on 2 September, wrote nine values correctly and
     * still reported partial because of Timezone alone.
     *
     * That is how a status stops meaning anything. If every good run says
     * partial, nobody reads partial, and the run that is genuinely half-finished
     * looks exactly like the eighty before it. So a known-absent field is still
     * reported, still listed in values_missing, and no longer changes the
     * verdict; an undocumented one still does, because that is a real surprise.
     */
    const unexpectedMissing = outcome.missing.filter(
      (name) => !KNOWN_ABSENT_CUSTOM_VALUES.has(name),
    );

    /*
     * Give the practice a login.
     *
     * The last manual step. Everything above builds an account and fills it in;
     * without this nobody at the practice can open it, which makes a
     * successfully provisioned sub-account useless to the only people who need
     * it.
     *
     * Deliberately not fatal, and deliberately not part of `status`. A
     * sub-account with every merge field filled and no user is still worth
     * keeping and still worth reporting as configured — the alternative is
     * throwing away a good account because one call failed. The reason is
     * recorded on the row, and provision-pending retries the submission.
     *
     * Skipped without complaint when there is no name or email to make one
     * from: both are required on the Hub form, but the GoHighLevel form can
     * arrive without them and an invented login is worse than none.
     */
    let userId: string | null = null;
    let userError: string | null = null;

    const loginName = pick(input.answers, 'doctor_name');
    const loginEmail = pick(input.answers, 'doctor_email');

    if (loginName === undefined || loginEmail === undefined) {
      userError = 'No doctor name or email on the submission, so no login was made.';
    } else {
      const { firstName, lastName } = splitName(loginName);
      try {
        const user = await createLocationUser({
          locationId,
          firstName,
          lastName,
          email: loginEmail,
          phone: pick(input.answers, 'doctor_phone'),
        });
        userId = user.userId;
        if (userId === null) {
          userError =
            'GoHighLevel accepted the user but returned no id, so it cannot be ' +
            'linked back to this run. Check the sub-account before retrying, or ' +
            'a second login will be created.';
        }
      } catch (error) {
        userError = error instanceof Error ? error.message : String(error);
      }
    }

    const status: ProvisionOutcome['status'] =
      outcome.failed.length > 0 || unexpectedMissing.length > 0
        ? 'partial'
        : 'values_written';

    await record(status, {
      locationId,
      written: outcome.written,
      missing: outcome.missing,
      failed: outcome.failed,
      userId,
      userError,
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
      ...(outcome.snapshotNotReady ? { snapshotNotReady: true } : {}),
      message:
        `Sub-account ready with ${outcome.written.length} value(s) filled.` +
        // Two very different causes, one of which used to be reported as the
        // other. Nothing at all means the snapshot is still being applied;
        // some fields present but not these means the names are wrong.
        (outcome.snapshotNotReady
          ? ' It has no custom values yet, which means GoHighLevel is still ' +
            'applying the snapshot rather than that anything is misconfigured. ' +
            'The next provision-pending run fills them; no action needed.'
          : unexpectedMissing.length > 0
            ? ` ${unexpectedMissing.length} had no matching field in the snapshot: ${unexpectedMissing.join(', ')}.`
            : outcome.missing.length > 0
              ? ` ${outcome.missing.length} known-absent field(s) were skipped: ` +
                `${outcome.missing.join(', ')} — documented in ` +
                'UNAVAILABLE_CUSTOM_VALUES, not a fault with this run.'
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
