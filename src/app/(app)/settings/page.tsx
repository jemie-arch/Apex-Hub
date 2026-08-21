import { AlertTriangle, Link2, RefreshCw } from 'lucide-react';

import { RunSyncButton } from '@/components/settings/RunSyncButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  UNCONFIRMED_TENANT_FIELDS,
  hasUnresolvedTenantPlaceholders,
  tenant,
} from '@/config/tenant.config';
import { formatCount, humanise } from '@/lib/format';
import { PLANNED_SYNCS, SYNCS } from '@/lib/sync/registry';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const db = serviceClient();

  const [tokens, clients, runs] = await Promise.all([
    db.from('oauth_tokens').select('provider, client_id, expires_at, last_error'),
    db
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .not('crm_location_id', 'is', null),
    db
      .from('sync_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(15),
  ]);

  if (tokens.error) throw tokens.error;
  if (runs.error) throw runs.error;

  const rows = tokens.data ?? [];
  const agency = rows.find(
    (row) => row.provider === 'gohighlevel' && row.client_id === null,
  );
  const locationTokens = rows.filter(
    (row) => row.provider === 'gohighlevel' && row.client_id !== null,
  ).length;
  const linkedClients = clients.count ?? 0;
  const clientNoun = tenant.vocabulary.client;
  const locationNoun = tenant.vocabulary.location;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Integrations, access and runtime configuration"
      />

      {hasUnresolvedTenantPlaceholders() ? (
        <div className="mb-6 flex gap-3 rounded-lg border border-line bg-warning-subtle p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-medium text-fg">
              Some tenant values are still guesses
            </p>
            <ul className="mt-1 list-inside list-disc text-sm text-fg-muted">
              {UNCONFIRMED_TENANT_FIELDS.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <section className="mb-6 rounded-lg border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-fg">Integrations</h2>
        <p className="mb-5 mt-0.5 text-xs text-fg-subtle">
          Connect the agency first — it lists the locations that become{' '}
          {clientNoun.plural}. Then connect each location whose calendar you
          want to read.
        </p>

        <div className="flex flex-col divide-y divide-line">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-medium text-fg">GoHighLevel — agency</p>
              <p className="text-xs text-fg-subtle">
                {agency
                  ? agency.last_error
                    ? `Last refresh failed: ${agency.last_error}`
                    : `Token expires ${agency.expires_at ? new Date(agency.expires_at).toISOString().slice(0, 16).replace('T', ' ') : 'unknown'} UTC`
                  : 'Not connected'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <StatusPill
                value={agency ? (agency.last_error ? 'error' : 'connected') : 'not connected'}
                tone={agency ? (agency.last_error ? 'negative' : 'positive') : 'neutral'}
              />
              <a
                href="/api/oauth/ghl/start?userType=Company"
                className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-fg hover:bg-surface-hover"
              >
                <Link2 size={14} />
                {agency ? 'Reconnect' : 'Connect'}
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-medium text-fg">
                GoHighLevel — locations
              </p>
              <p className="text-xs text-fg-subtle">
                {formatCount(locationTokens)} of {formatCount(linkedClients)}{' '}
                {locationNoun.plural} have a token. Ones without cannot sync
                bookings.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <StatusPill
                value={
                  linkedClients === 0
                    ? 'none yet'
                    : locationTokens >= linkedClients
                      ? 'complete'
                      : 'partial'
                }
                tone={
                  linkedClients === 0
                    ? 'neutral'
                    : locationTokens >= linkedClients
                      ? 'positive'
                      : 'warning'
                }
              />
              <a
                href="/api/oauth/ghl/start?userType=Location"
                className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-fg hover:bg-surface-hover"
              >
                <Link2 size={14} />
                Connect a location
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-medium text-fg">Windsor.ai — ad spend</p>
              <p className="text-xs text-fg-subtle">
                Needs WINDSOR_API_KEY, and an ad account id on each{' '}
                {locationNoun.singular}. Locations without one are skipped.
              </p>
            </div>
            <StatusPill
              value={process.env.WINDSOR_API_KEY ? 'configured' : 'no api key'}
              tone={process.env.WINDSOR_API_KEY ? 'positive' : 'warning'}
            />
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-lg border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-fg">Run a sync by hand</h2>
        <p className="mb-5 mt-0.5 text-xs text-fg-subtle">
          Every sync is idempotent — re-running one never duplicates a record,
          so it is always safe to press. Clients first: {clientNoun.plural} must
          exist before bookings can hang off them.
        </p>

        <div className="flex flex-col gap-4">
          {Object.values(SYNCS).map((definition) => (
            <div
              key={definition.name}
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <p className="font-mono text-sm text-fg">{definition.name}</p>
                <p className="text-xs text-fg-subtle">{definition.description}</p>
              </div>
              <RunSyncButton name={definition.name} label="Run now" />
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">Recent syncs</h2>
          <span className="text-xs text-fg-subtle">
            {Object.keys(SYNCS).length} built · {PLANNED_SYNCS.length} planned
          </span>
        </div>

        {(runs.data ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fg-muted">
            No sync has run yet. Connect the agency above, then press Run now.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Sync</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Trigger</th>
                  <th className="px-4 py-3 text-right font-medium">Read</th>
                  <th className="px-4 py-3 text-right font-medium">Created</th>
                  <th className="px-4 py-3 text-right font-medium">Updated</th>
                  <th className="px-4 py-3 text-right font-medium">Errors</th>
                  <th className="px-4 py-3 text-right font-medium">Took</th>
                  <th className="px-4 py-3 font-medium">Started (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {(runs.data ?? []).map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-line last:border-0 hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3 font-medium text-fg">{run.name}</td>
                    <td className="px-4 py-3">
                      <StatusPill
                        value={run.status}
                        tone={
                          run.status === 'success'
                            ? 'positive'
                            : run.status === 'partial'
                              ? 'warning'
                              : run.status === 'error'
                                ? 'negative'
                                : 'neutral'
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {humanise(run.triggered_by)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatCount(run.records_read)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatCount(run.records_created)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatCount(run.records_updated)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {run.error_count > 0 ? (
                        <span className="text-negative">
                          {formatCount(run.error_count)}
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {run.duration_ms === null ? '—' : `${run.duration_ms}ms`}
                    </td>
                    <td className="numeric px-4 py-3 text-fg-subtle">
                      {run.started_at.slice(0, 16).replace('T', ' ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-fg-subtle">
        <RefreshCw size={12} />
        Vercel cron is the only scheduler. Do not add a CI job against this
        database as well.
      </p>
    </>
  );
}
