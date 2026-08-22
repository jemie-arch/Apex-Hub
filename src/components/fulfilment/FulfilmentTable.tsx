'use client';

/**
 * Practices on the left, the one you clicked on the right.
 *
 * The same split as ads management, for the same reason: a table answers "who
 * needs attention" and an inspector answers "what about them", and putting the
 * second inside a row would make every row twenty fields wide.
 *
 * The filters are the questions this page exists to ask. "Owed money" is not a
 * subset for tidiness — it is the pay-per-show failure this whole tracker was
 * built to catch, so it is one press away.
 */
import { ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';
import { FilterPills } from '@/components/ui/FilterPills';
import { Inspector, InspectorSection } from '@/components/ui/Inspector';
import { cn } from '@/lib/cn';
import { formatCount, formatMoney, formatPercent } from '@/lib/format';

export interface FulfilmentRow {
  clientId: string;
  name: string;
  isActive: boolean;
  booked: number;
  showed: number;
  noShow: number;
  upcoming: number;
  undecided: number;
  closed: number;
  withOutcome: number;
  collectedCents: number;
  uncollectedCents: number;
}

type Filter = 'all' | 'owed' | 'unmarked' | 'quiet';

function showRateOf(row: FulfilmentRow): number | null {
  const settled = row.showed + row.noShow;
  return settled === 0 ? null : row.showed / settled;
}

export function FulfilmentTable({
  rows,
  clientNoun,
}: {
  rows: FulfilmentRow[];
  clientNoun: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(
    rows[0]?.clientId ?? null,
  );

  const counts = useMemo(
    () => ({
      all: rows.length,
      owed: rows.filter((row) => row.uncollectedCents > 0).length,
      unmarked: rows.filter((row) => row.undecided > 0).length,
      quiet: rows.filter((row) => row.booked === 0).length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    if (filter === 'owed') return rows.filter((row) => row.uncollectedCents > 0);
    if (filter === 'unmarked') return rows.filter((row) => row.undecided > 0);
    if (filter === 'quiet') return rows.filter((row) => row.booked === 0);
    return rows;
  }, [rows, filter]);

  const selected =
    rows.find((row) => row.clientId === selectedId) ?? visible[0] ?? null;

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing booked in this period"
        description="Widen the date range, or check that the tracker import has run."
        icon={<ClipboardList size={22} />}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
      <section className="panel overflow-hidden rounded-lg border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              All {clientNoun}
            </h2>
            <p className="text-xs text-fg-subtle">
              Click a row to inspect it on the right
            </p>
          </div>

          <FilterPills
            value={filter}
            onChange={setFilter}
            options={[
              { key: 'all', label: 'All', count: counts.all },
              { key: 'owed', label: 'Owed money', count: counts.owed },
              { key: 'unmarked', label: 'Unmarked', count: counts.unmarked },
              { key: 'quiet', label: 'No bookings', count: counts.quiet },
            ]}
          />
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                <th className="px-4 py-2.5 font-medium">{clientNoun}</th>
                <th className="px-4 py-2.5 text-right font-medium">Booked</th>
                <th className="px-4 py-2.5 text-right font-medium">Showed</th>
                <th className="px-4 py-2.5 text-right font-medium">Show rate</th>
                <th className="px-4 py-2.5 text-right font-medium">Collected</th>
                <th className="px-4 py-2.5 text-right font-medium">Owed</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const rate = showRateOf(row);
                const isSelected = selected?.clientId === row.clientId;

                return (
                  <tr
                    key={row.clientId}
                    onClick={() => setSelectedId(row.clientId)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(row.clientId);
                      }
                    }}
                    className={cn(
                      'row-interactive cursor-pointer border-b border-line last:border-0 focus:outline-none',
                      isSelected
                        ? 'bg-accent-subtle/40 shadow-[inset_2px_0_0_0_var(--accent)]'
                        : 'hover:bg-surface-hover',
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <span className="block truncate font-medium text-fg">
                        {row.name}
                      </span>
                      {!row.isActive ? (
                        <span className="text-[11px] text-fg-subtle">paused</span>
                      ) : null}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right text-fg">
                      {row.booked || '—'}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right text-positive">
                      {row.showed || '—'}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right text-fg-muted">
                      {rate === null ? '—' : formatPercent(rate)}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right text-positive">
                      {row.collectedCents > 0 ? formatMoney(row.collectedCents) : '—'}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right">
                      {row.uncollectedCents > 0 ? (
                        <span className="text-negative">
                          {formatMoney(row.uncollectedCents)}
                        </span>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {visible.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-fg-subtle">
              No {clientNoun} match this filter — which in this case is good news.
            </p>
          ) : null}
        </div>
      </section>

      {selected ? <Detail row={selected} /> : null}
    </div>
  );
}

function Detail({ row }: { row: FulfilmentRow }) {
  const rate = showRateOf(row);
  const funnel = [
    { label: 'Booked', value: row.booked, tone: 'bg-chart-6' },
    { label: 'Showed', value: row.showed, tone: 'bg-positive' },
    { label: 'Closed', value: row.closed, tone: 'bg-accent' },
  ];
  const widest = Math.max(...funnel.map((step) => step.value), 1);

  return (
    <Inspector
      title={row.name}
      status={row.isActive ? 'Active' : 'Paused'}
      metrics={[
        { label: 'booked', value: formatCount(row.booked) },
        { label: 'showed', value: formatCount(row.showed) },
        {
          label: 'show rate',
          value: rate === null ? '—' : formatPercent(rate, 0),
          accent: true,
        },
      ]}
    >
      <InspectorSection title="Funnel">
        <div className="space-y-2">
          {funnel.map((step) => (
            <div key={step.label} className="flex items-center gap-2.5">
              <div className="h-6 flex-1 overflow-hidden rounded bg-chart-track">
                <div
                  className={cn(
                    'flex h-full items-center rounded px-2 transition-all duration-500',
                    step.tone,
                  )}
                  style={{
                    width: `${Math.max(8, Math.round((step.value / widest) * 100))}%`,
                  }}
                >
                  <span className="truncate text-[11px] font-medium text-accent-contrast">
                    {step.label}
                  </span>
                </div>
              </div>
              <span className="numeric w-8 shrink-0 text-right text-xs text-fg-muted">
                {formatCount(step.value)}
              </span>
            </div>
          ))}
        </div>
      </InspectorSection>

      <InspectorSection title="Money">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-subtle">Collected</dt>
            <dd className="numeric text-positive">
              {row.collectedCents > 0 ? formatMoney(row.collectedCents) : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-subtle">Failed</dt>
            <dd className="numeric">
              {row.uncollectedCents > 0 ? (
                <span className="text-negative">
                  {formatMoney(row.uncollectedCents)}
                </span>
              ) : (
                <span className="text-fg-subtle">—</span>
              )}
            </dd>
          </div>
        </dl>

        {row.uncollectedCents > 0 ? (
          <p className="mt-2.5 text-[11px] text-negative">
            A charge was attempted and refused. Worth chasing before the next
            consultation goes ahead unpaid.
          </p>
        ) : null}
      </InspectorSection>

      <InspectorSection title="Not yet marked up">
        {row.undecided === 0 && row.upcoming === 0 ? (
          <p className="text-xs text-fg-subtle">
            Every consultation in this period has been marked showed or missed.
          </p>
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-subtle">Date passed, unmarked</dt>
              <dd className="numeric text-warning">{formatCount(row.undecided)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-subtle">Still to come</dt>
              <dd className="numeric text-fg-muted">{formatCount(row.upcoming)}</dd>
            </div>
          </dl>
        )}

        {row.undecided > 0 ? (
          <p className="mt-2.5 text-[11px] text-fg-subtle">
            An unmarked consultation cannot be billed and does not count in the
            show rate, so it is money and accuracy both.
          </p>
        ) : null}
      </InspectorSection>

      <Link
        href={`/clients/${row.clientId}`}
        className="block text-xs text-accent hover:underline"
      >
        Open this {row.name} record →
      </Link>
    </Inspector>
  );
}
