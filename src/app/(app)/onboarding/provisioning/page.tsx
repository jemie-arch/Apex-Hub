import { AlertTriangle, ExternalLink, Server } from 'lucide-react';

import { RetryProvisioning } from '@/components/onboarding/RetryProvisioning';
import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import {
  ONBOARDING_SNAPSHOT_ID,
  UNAVAILABLE_CUSTOM_VALUES,
} from '@/config/provisioning';
import { formatCount } from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Provisioning' };

const STATUS_TONE: Record<string, Tone> = {
  values_written: 'positive',
  partial: 'warning',
  created: 'warning',
  failed: 'negative',
};

const STATUS_LABEL: Record<string, string> = {
  values_written: 'Ready',
  partial: 'Built, some values missing',
  created: 'Account made, values not written',
  failed: 'Failed',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

/**
 * What happened when each onboarding form tried to build its sub-account.
 *
 * Every attempt is listed, not just the latest per practice. "It worked on the
 * third try" and "it worked" are different facts, and only one of them means
 * somebody should go and fix the cause.
 */
export default async function ProvisioningPage() {
  const db = serviceClient();

  const [runs, submissions] = await Promise.all([
    db
      .from('provisioning_runs')
      .select(
        'id, clinic_name, status, crm_location_id, values_written, values_missing, values_failed, error, scope_problem, created_at, submission_id',
      )
      .order('created_at', { ascending: false })
      .limit(100),
    // Onboarding submissions, so any with no attempt can be found. Without this
    // an answer set with no attempt row was unreachable from every screen.
    db
      .from('form_submissions')
      .select('id, clinic_name, person_name, submitted_at')
      .eq('form_key', 'client_onboarding')
      .eq('is_test', false)
      .order('submitted_at', { ascending: false })
      .limit(100),
  ]);

  if (runs.error) throw runs.error;
  if (submissions.error) throw submissions.error;

  const rows = runs.data ?? [];
  const attempted = new Set(
    rows.map((row) => row.submission_id).filter((id): id is string => id !== null),
  );
  const neverAttempted = (submissions.data ?? []).filter(
    (row) => !attempted.has(row.id),
  );
  const ready = rows.filter((row) => row.status === 'values_written').length;
  const needsWork = rows.filter(
    (row) => row.status === 'failed' || row.status === 'created',
  ).length;
  const scopeBlocked = rows.filter((row) => row.scope_problem).length;

  return (
    <>
      <PageHeader
        eyebrow="Onboarding"
        pill={{
          label: `${formatCount(rows.length)} attempts`,
          tone: needsWork > 0 ? 'warning' : 'positive',
        }}
        title="Sub-accounts built from the form"
        description={
          <>
            Every practice that submitted the onboarding form gets a GoHighLevel
            sub-account from snapshot{' '}
            <span className="numeric text-accent">{ONBOARDING_SNAPSHOT_ID}</span>,
            with its custom values filled from the answers.
          </>
        }
      />

      {scopeBlocked > 0 ? (
        <section className="mb-6 rounded-lg border border-negative-subtle bg-surface p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-negative">
            <AlertTriangle size={14} /> The connected app cannot create
            sub-accounts yet
          </h2>
          <p className="mt-1.5 max-w-3xl text-xs text-fg-muted">
            {formatCount(scopeBlocked)} attempt(s) were refused as unauthorised.
            The GoHighLevel marketplace app is installed with read access to
            locations but not write — asking it for{' '}
            <span className="numeric">/snapshots/</span> answers 401 while{' '}
            <span className="numeric">/locations/</span> answers 200, which is the
            signature of a missing scope rather than a missing account.
          </p>
          <p className="mt-2 max-w-3xl text-xs text-fg-muted">
            Re-authorise the app in GoHighLevel agency settings with{' '}
            <span className="numeric text-fg">locations.write</span> and{' '}
            <span className="numeric text-fg">snapshots.readonly</span>, then press
            Retry on any row below. Nothing was lost — every answer is saved.
          </p>
        </section>
      ) : null}

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KPICard label="Ready" value={formatCount(ready)} hint="built and filled" />
        <KPICard
          label="Needs a retry"
          value={formatCount(needsWork)}
          hint={needsWork === 0 ? 'nothing outstanding' : 'failed or half-built'}
        />
        <KPICard
          label="Attempts"
          value={formatCount(rows.length)}
          hint="every try, not one per practice"
        />
      </section>

      {neverAttempted.length > 0 ? (
        <section className="mb-6 panel rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-fg">
            {formatCount(neverAttempted.length)} submission(s) never attempted
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-fg-subtle">
            The answers are saved and no sub-account was built from them. Press
            Provision to build one now.
          </p>

          <ul className="mt-3 space-y-2">
            {neverAttempted.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-sunken px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">
                    {row.clinic_name ?? 'No clinic name'}
                  </span>
                  <span className="block text-[11px] text-fg-subtle">
                    {row.person_name ?? 'no name'} · {when(row.submitted_at)}
                  </span>
                </span>
                <RetryProvisioning
                  submissionId={row.id}
                  disabled={row.clinic_name === null}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {rows.length === 0 && neverAttempted.length === 0 ? (
        <EmptyState
          title="Nothing has been provisioned yet"
          description="The first onboarding form submission builds its sub-account automatically, and lands here."
          icon={<Server size={22} />}
        />
      ) : rows.length === 0 ? null : (
        <div className="space-y-3">
          {rows.map((row) => {
            const failed = (row.values_failed ?? []) as Array<{
              name?: string;
              reason?: string;
            }>;

            return (
              <article
                key={row.id}
                className="panel rounded-lg border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-medium text-fg">
                        {row.clinic_name}
                      </h2>
                      <StatusPill
                        value={STATUS_LABEL[row.status] ?? row.status}
                        tone={STATUS_TONE[row.status] ?? 'neutral'}
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {when(row.created_at)}
                      {row.crm_location_id ? (
                        <>
                          {' · '}
                          <a
                            href={`https://app.gohighlevel.com/v2/location/${row.crm_location_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-accent hover:underline"
                          >
                            <ExternalLink size={10} /> open in GoHighLevel
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>

                  {row.status !== 'values_written' ? (
                    <RetryProvisioning
                      runId={row.id}
                      disabled={row.submission_id === null}
                    />
                  ) : null}
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-fg-subtle">Values written</dt>
                    <dd className="numeric text-positive">
                      {formatCount(row.values_written.length)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-subtle">No matching field</dt>
                    <dd className="numeric text-warning">
                      {formatCount(row.values_missing.length)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-subtle">Refused</dt>
                    <dd className="numeric text-negative">
                      {formatCount(failed.length)}
                    </dd>
                  </div>
                </dl>

                {row.values_missing.length > 0 ? (
                  <p className="mt-2 text-[11px] text-fg-subtle">
                    Not in the snapshot:{' '}
                    <span className="text-fg-muted">
                      {row.values_missing.join(', ')}
                    </span>
                    . These are mapping or snapshot mismatches, not lost answers —
                    the answers are on the submission either way.
                  </p>
                ) : null}

                {row.error ? (
                  <pre className="mt-2 overflow-x-auto rounded border border-line bg-surface-sunken p-2 text-[11px] text-fg-muted">
                    {row.error}
                  </pre>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <section className="mt-6 rounded-lg border border-accent-subtle bg-surface p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <AlertTriangle size={14} /> Two fields the brief asked for that do not
          exist
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-fg-subtle">
          Read off a live snapshot-provisioned sub-account rather than assumed. The
          form still collects them, so they are on every submission and can be
          written the moment the custom value is added to the snapshot.
        </p>
        <dl className="mt-3 space-y-3">
          {UNAVAILABLE_CUSTOM_VALUES.map((entry) => (
            <div key={entry.brief}>
              <dt className="text-sm font-medium text-fg">{entry.brief}</dt>
              <dd className="mt-0.5 max-w-3xl text-xs text-fg-muted">
                {entry.note}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
