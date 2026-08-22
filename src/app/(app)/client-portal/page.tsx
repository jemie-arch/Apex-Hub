import { ExternalLink, Users } from 'lucide-react';
import Link from 'next/link';

import { CopyPortalLink } from '@/components/clients/CopyPortalLink';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import { formatCount, humanise } from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Client Portal' };

/**
 * The way in to a client's portal.
 *
 * There is no single address for "the client portal" — it is one portal per
 * client, and the URL is the credential. So switching to it cannot be a
 * navigation like the others; it has to be a choice of *which* client, which is
 * what this page is for.
 *
 * Opening one is deliberately a new tab. The portal has its own shell and no
 * internal navigation, and replacing this tab with it would strand somebody
 * inside a client's view with no way back.
 */
/**
 * This site's own address, for a link somebody will paste into an email.
 *
 * A relative path is useless once it leaves the app, so the copy button needs an
 * absolute URL. NEXT_PUBLIC_APP_URL if it is set, otherwise the address Vercel
 * gives the deployment; falling back to a relative link is better than
 * fabricating a hostname that would send a client somewhere that does not exist.
 */
function siteOrigin(): string {
  const configured = process.env['NEXT_PUBLIC_APP_URL']?.trim();
  if (configured) return configured.replace(/\/$/, '');

  const vercel = process.env['VERCEL_PROJECT_PRODUCTION_URL'] ?? process.env['VERCEL_URL'];
  return vercel ? `https://${vercel}` : '';
}

export default async function ClientPortalIndexPage() {
  const db = serviceClient();
  const origin = siteOrigin();

  const [groups, locations] = await Promise.all([
    db
      .from('client_groups')
      .select('id, name, status, onboarding_stage, portal_token, portal_enabled')
      .order('name'),
    db.from('clients').select('group_id, is_active'),
  ]);

  if (groups.error) throw groups.error;
  if (locations.error) throw locations.error;

  const locationCount = new Map<string, number>();
  for (const row of locations.data ?? []) {
    if (!row.group_id) continue;
    locationCount.set(row.group_id, (locationCount.get(row.group_id) ?? 0) + 1);
  }

  const rows = groups.data ?? [];
  const live = rows.filter((row) => row.portal_enabled && row.portal_token);
  const client = tenant.vocabulary.client;

  return (
    <>
      <PageHeader
        title="Client Portal"
        description={`Open a ${client.singular}'s own view of their results`}
      />

      <div className="mb-6 rounded-lg border border-line bg-surface p-4">
        <p className="max-w-3xl text-sm text-fg-muted">
          Each {client.singular} has their own portal, reached by a private link
          rather than a login — so the link <em>is</em> the credential. Send it to
          the practice, not to a group inbox, and use{' '}
          <span className="text-fg">Copy link</span> rather than retyping it.
          Anyone at the practice who needs their own can request one from inside
          the portal, and you approve it here.
        </p>
      </div>

      {live.length === 0 ? (
        <EmptyState
          title="No portals are switched on"
          description={`Enable a portal on a ${client.singular}'s record to give them a link.`}
          icon={<Users size={22} />}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">
                    {titleCase(client.singular)}
                  </th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Onboarding</th>
                  <th className="px-4 py-3 text-right font-medium">Locations</th>
                  <th className="px-4 py-3 text-right font-medium">Portal</th>
                </tr>
              </thead>
              <tbody>
                {live.map((row) => {
                  const href = `/portal/${row.portal_token}`;
                  const shareable = `${origin}${href}`;

                  return (
                    <tr
                      key={row.id}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/clients/${row.id}`}
                          className="font-medium text-fg hover:text-accent"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          value={row.status}
                          tone={row.status === 'active' ? 'positive' : 'neutral'}
                        />
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {humanise(row.onboarding_stage)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {formatCount(locationCount.get(row.id) ?? 0)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <CopyPortalLink url={shareable} />
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                          >
                            <ExternalLink size={12} /> Open
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-fg-subtle">
        {formatCount(live.length)} of {formatCount(rows.length)}{' '}
        {client.plural} have a portal switched on.
        {origin === ''
          ? ' Set NEXT_PUBLIC_APP_URL so copied links are absolute and work outside the app.'
          : ''}
      </p>
    </>
  );
}
