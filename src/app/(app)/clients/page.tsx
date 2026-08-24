import { Users } from 'lucide-react';
import Link from 'next/link';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterPillLinks } from '@/components/ui/FilterPills';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill, clientStatusTone } from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import { HEALTH_TONE, getGroupRollups } from '@/lib/client-metrics';
import {
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatMultiple,
  formatPercent,
} from '@/lib/format';
import { resolveRange } from '@/lib/range';

export const dynamic = 'force-dynamic';

export const metadata = { title: titleCase(tenant.vocabulary.client.plural) };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The tabs, and why they are these five.
 *
 * client_status has exactly four values, and 'all' is the unfiltered view. The
 * tab that is easy to leave out is Onboarding: 19 businesses sit there, and
 * without a tab of their own they would only ever be visible under All while
 * every other status got a filter. A tab set that hides its largest minority is
 * worse than no tabs.
 *
 * Two of these will read nought today, and that is the honest state rather than
 * a bug to hide. refresh_client_statuses() only ever moves a group between
 * 'active' and 'onboarding' — nothing derives 'paused' or 'churned', so they are
 * only ever set by hand. Every group currently marked paused is one of Apex's
 * own internal sub-accounts, and those are already excluded from this page. The
 * tabs are still right to have: they are where a paused or churned client shows
 * up the moment somebody marks one, instead of vanishing into All.
 */
const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'paused', label: 'Paused' },
  { key: 'churned', label: 'Churned' },
] as const;

type StatusTab = (typeof STATUS_TABS)[number]['key'];

function resolveTab(value: string | undefined): StatusTab {
  return STATUS_TABS.some((tab) => tab.key === value)
    ? (value as StatusTab)
    : 'all';
}

export default async function ClientsPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const allRollups = await getGroupRollups(range);
  const client = tenant.vocabulary.client;
  const location = tenant.vocabulary.location;
  const booking = tenant.vocabulary.booking;

  const tab = resolveTab(single(searchParams['status']));

  /*
   * Counted off the unfiltered set, so every tab shows its own size whichever
   * one is open. A count that only appears once you are already looking at the
   * tab is not much of a filter.
   */
  const countFor = (key: StatusTab): number =>
    key === 'all'
      ? allRollups.length
      : allRollups.filter((r) => r.group.status === key).length;

  const rollups =
    tab === 'all'
      ? allRollups
      : allRollups.filter((r) => r.group.status === tab);

  /*
   * The date range is carried through, because the two controls answer different
   * questions and dropping one when you press the other is how a filter becomes
   * annoying. Status stays out of the URL on 'all' so the default has a clean
   * link.
   */
  const hrefFor = (key: StatusTab): string => {
    const params = new URLSearchParams();
    for (const field of ['preset', 'from', 'to'] as const) {
      const value = single(searchParams[field]);
      if (value) params.set(field, value);
    }
    if (key !== 'all') params.set('status', key);
    const query = params.toString();
    return query ? `/clients?${query}` : '/clients';
  };

  const active = countFor('active');
  const onboarding = countFor('onboarding');

  return (
    <>
      <PageHeader
        eyebrow="Book of business"
        pill={{
          label: `${formatCount(active)} trading`,
          tone: 'positive',
        }}
        title={titleCase(client.plural)}
        description={
          `${formatCount(active)} active · ${formatCount(onboarding)} onboarding · ` +
          range.label
        }
        actions={<DateRangePicker />}
      />

      <div className="mb-4">
        <FilterPillLinks
          options={STATUS_TABS.map((option) => ({
            key: option.key,
            label: option.label,
            count: countFor(option.key),
            // Built here, on the server. The pills are a client component and a
            // function prop cannot cross that boundary.
            href: hrefFor(option.key),
          }))}
          value={tab}
        />
      </div>

      {/*
        Two different empty states. "No clients yet" means the sync has never
        run and is a setup problem; an empty tab means this status simply has
        nobody in it, which for paused and churned is the normal case. Showing
        the setup message on an empty tab would send somebody to re-run a sync
        that is working fine.
      */}
      {allRollups.length > 0 && rollups.length === 0 ? (
        <EmptyState
          title={`No ${client.plural} are ${tab}`}
          description={
            tab === 'paused' || tab === 'churned'
              ? `Nothing derives "${tab}" — it is only ever set by hand, so this ` +
                'stays empty until somebody marks a business that way.'
              : `No ${client.plural} currently hold this status.`
          }
          icon={<Users size={22} />}
        />
      ) : rollups.length === 0 ? (
        <EmptyState
          title={`No ${client.plural} yet`}
          description={
            `${titleCase(client.plural)} arrive from the CRM sync — one business ` +
            `per GoHighLevel location. Run crm-clients from settings to pull ` +
            'them in, then merge any that share a practice.'
          }
          icon={<Users size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">
                    {titleCase(client.singular)}
                  </th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Health</th>
                  <th className="px-4 py-3 text-right font-medium">Retainer</th>
                  <th className="px-4 py-3 text-right font-medium">
                    {titleCase(booking.plural)}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Showed</th>
                  <th className="px-4 py-3 text-right font-medium">Won</th>
                  <th className="px-4 py-3 text-right font-medium">Spend</th>
                  <th className="px-4 py-3 text-right font-medium">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {rollups.map((rollup) => (
                  <tr
                    key={rollup.group.id}
                    className="row-interactive border-b border-line last:border-0 hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/clients/${rollup.group.id}`}
                        className="font-medium text-fg hover:text-accent"
                      >
                        {rollup.group.name}
                      </Link>
                      <span className="block text-xs text-fg-subtle">
                        {rollup.locations.length === 0
                          ? `no ${location.singular} linked`
                          : rollup.locations.length === 1
                            ? rollup.locations[0]?.timezone
                            : `${formatCount(rollup.locations.length)} ${location.plural}`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        value={rollup.group.status}
                        tone={clientStatusTone(rollup.group.status)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span title={rollup.health.reason}>
                        <StatusPill
                          value={rollup.health.level.replace('_', ' ')}
                          tone={HEALTH_TONE[rollup.health.level]}
                        />
                      </span>
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatMoney(
                        rollup.group.retainer_cents,
                        rollup.group.currency,
                      )}
                    </td>
                    <td className="numeric px-4 py-3 text-right font-medium text-fg">
                      {formatCount(rollup.booked)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatPercent(rollup.showRate, 0)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatCount(rollup.converted)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatMoneyCompact(
                        rollup.spendCents,
                        rollup.group.currency,
                      )}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatMultiple(rollup.roas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
