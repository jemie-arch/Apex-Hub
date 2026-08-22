import { Users } from 'lucide-react';
import Link from 'next/link';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
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

export default async function ClientsPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const rollups = await getGroupRollups(range);
  const client = tenant.vocabulary.client;
  const location = tenant.vocabulary.location;
  const booking = tenant.vocabulary.booking;

  const active = rollups.filter((r) => r.group.status === 'active').length;
  const onboarding = rollups.filter(
    (r) => r.group.status === 'onboarding',
  ).length;

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

      {rollups.length === 0 ? (
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
