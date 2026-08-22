import { Scale } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { tenant, titleCase } from '@/config/tenant.config';
import { cn } from '@/lib/cn';
import {
  formatCount,
  formatMoneyCompact,
  formatMultiple,
  formatPercent,
} from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Compare' };

/** How many months of history the tracker shows. */
const MONTHS = 6;

type MetricKey = 'booked' | 'showed' | 'won' | 'spend' | 'roas';

const METRICS: ReadonlyArray<{ key: MetricKey; label: string }> = [
  { key: 'booked', label: 'Booked' },
  { key: 'showed', label: 'Show rate' },
  { key: 'won', label: 'Won' },
  { key: 'spend', label: 'Spend' },
  { key: 'roas', label: 'ROAS' },
];

interface MonthCell {
  booked: number;
  showed: number;
  won: number;
  revenueCents: number;
  spendCents: number;
}

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** First day of the month, N months back, in UTC. */
function monthStart(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function emptyCell(): MonthCell {
  return { booked: 0, showed: 0, won: 0, revenueCents: 0, spendCents: 0 };
}

export default async function ComparePage({ searchParams }: PageProps) {
  const metric = (single(searchParams['metric']) ?? 'booked') as MetricKey;
  const active = METRICS.some((m) => m.key === metric) ? metric : 'booked';

  const db = serviceClient();

  const windowStart = monthStart(MONTHS - 1);
  const months = Array.from({ length: MONTHS }, (_, index) =>
    monthKey(monthStart(MONTHS - 1 - index)),
  );

  const [groups, locations, appointments, snapshots] = await Promise.all([
    db
      .from('client_groups')
      .select('id, name, status, currency')
      .neq('status', 'churned')
      .order('name'),
    db.from('clients').select('id, group_id'),
    db
      .from('appointments')
      .select('client_id, scheduled_at, showed, outcome, value_cents')
      .gte('scheduled_at', windowStart.toISOString()),
    db
      .from('ad_snapshots')
      .select('client_id, snapshot_on, spend_cents')
      .gte('snapshot_on', windowStart.toISOString().slice(0, 10)),
  ]);

  if (groups.error) throw groups.error;
  if (locations.error) throw locations.error;
  if (appointments.error) throw appointments.error;
  if (snapshots.error) throw snapshots.error;

  const groupIdByLocation = new Map(
    (locations.data ?? []).map((row) => [row.id, row.group_id]),
  );

  // group id -> month key -> totals
  const grid = new Map<string, Map<string, MonthCell>>();
  const cellFor = (groupId: string, month: string): MonthCell => {
    const byMonth = grid.get(groupId) ?? new Map<string, MonthCell>();
    const cell = byMonth.get(month) ?? emptyCell();
    byMonth.set(month, cell);
    grid.set(groupId, byMonth);
    return cell;
  };

  for (const row of appointments.data ?? []) {
    const groupId = groupIdByLocation.get(row.client_id);
    if (!groupId) continue;

    const cell = cellFor(groupId, row.scheduled_at.slice(0, 7));
    cell.booked += 1;
    if (row.showed === true) cell.showed += 1;
    if (row.outcome === 'won') {
      cell.won += 1;
      cell.revenueCents += row.value_cents ?? 0;
    }
  }

  for (const row of snapshots.data ?? []) {
    const groupId = groupIdByLocation.get(row.client_id);
    if (!groupId) continue;

    cellFor(groupId, row.snapshot_on.slice(0, 7)).spendCents += row.spend_cents;
  }

  function render(cell: MonthCell | undefined, currency: string): string {
    if (!cell) return '—';

    switch (active) {
      case 'showed':
        return formatPercent(cell.booked === 0 ? null : cell.showed / cell.booked, 0);
      case 'won':
        return formatCount(cell.won);
      case 'spend':
        return formatMoneyCompact(cell.spendCents, currency);
      case 'roas':
        return formatMultiple(
          cell.spendCents === 0 ? null : cell.revenueCents / cell.spendCents,
        );
      case 'booked':
      default:
        return formatCount(cell.booked);
    }
  }

  /** Raw comparable value, for the month-on-month arrow. */
  function value(cell: MonthCell | undefined): number | null {
    if (!cell) return null;
    switch (active) {
      case 'showed':
        return cell.booked === 0 ? null : cell.showed / cell.booked;
      case 'won':
        return cell.won;
      case 'spend':
        return cell.spendCents;
      case 'roas':
        return cell.spendCents === 0 ? null : cell.revenueCents / cell.spendCents;
      case 'booked':
      default:
        return cell.booked;
    }
  }

  // Spend rising is not an improvement on its own, so it gets no green arrow.
  const higherIsBetter = active !== 'spend';
  const client = tenant.vocabulary.client;
  const rows = groups.data ?? [];

  return (
    <>
      <PageHeader
        title="Compare"
        description={`${titleCase(client.singular)} performance, month over month`}
      />

      <div className="mb-5 inline-flex flex-wrap rounded-md border border-line bg-surface p-0.5">
        {METRICS.map((option) => (
          <Link
            key={option.key}
            href={`/compare?metric=${option.key}`}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors',
              option.key === active
                ? 'bg-accent-subtle text-accent'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing to compare yet"
          description={`Run the CRM sync to bring ${client.plural} in.`}
          icon={<Scale size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="sticky left-0 bg-surface px-4 py-3 font-medium">
                    {titleCase(client.singular)}
                  </th>
                  {months.map((month) => (
                    <th key={month} className="px-4 py-3 text-right font-medium">
                      {new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString(
                        undefined,
                        { month: 'short', year: '2-digit' },
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((group) => {
                  const byMonth = grid.get(group.id);

                  return (
                    <tr
                      key={group.id}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="sticky left-0 bg-surface px-4 py-3">
                        <Link
                          href={`/clients/${group.id}`}
                          className="font-medium text-fg hover:text-accent"
                        >
                          {group.name}
                        </Link>
                      </td>
                      {months.map((month, index) => {
                        const cell = byMonth?.get(month);
                        const current = value(cell);
                        const prior =
                          index === 0
                            ? null
                            : value(byMonth?.get(months[index - 1] ?? ''));

                        const better =
                          current !== null && prior !== null && prior !== current
                            ? (current > prior) === higherIsBetter
                            : null;

                        return (
                          <td
                            key={month}
                            className={cn(
                              'numeric px-4 py-3 text-right',
                              better === null && 'text-fg-muted',
                              better === true && 'text-positive',
                              better === false && 'text-negative',
                            )}
                          >
                            {render(cell, group.currency)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-fg-subtle">
        Colour compares each month with the one before it. Rising spend is not
        coloured as an improvement on its own — read it next to ROAS.
      </p>
    </>
  );
}
