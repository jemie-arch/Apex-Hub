'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { RENDERERS } from '@/components/cft/cells';
import { StatsDashboardTable } from '@/components/cft/StatsDashboardTable';
import { WideTableScroll } from '@/components/cft/WideTableScroll';
import { Inspector, InspectorSection } from '@/components/ui/Inspector';
import { COLUMNS, SECTIONS } from '@/lib/cft-columns';
import { type Breakdown, type DashboardRow, derive } from '@/lib/cft-stats';
import { formatMoney, formatPercent } from '@/lib/format';

/**
 * The tracker table and the panel that reads one row of it.
 *
 * Thirty-three columns is more than anyone holds in their head at once. The
 * table answers "which campaign", scanning across; the panel answers "what
 * about this one", reading down — the same split the ads, fulfilment and
 * consultations tables already make with the shared Inspector.
 *
 * Selection lives here rather than in the table because the panel sits OUTSIDE
 * the horizontal scroll container. Owned one level down, it would scroll away
 * sideways with the columns.
 *
 * A client component, like the other three tables with an inspector: a
 * selection that survives a server round trip per click would feel broken, and
 * these are at most a few dozen rows.
 */
export function StatsDashboard({
  rows,
  totals,
  breakdown,
  sort,
  direction,
  sortHrefs,
}: {
  rows: DashboardRow[];
  totals: DashboardRow;
  breakdown: Breakdown;
  sort: number | null;
  direction: 'asc' | 'desc';
  sortHrefs: string[];
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = rows.find((row) => row.key === selectedKey) ?? null;

  return (
    /*
     * minmax(0,1fr) on the table column, not 1fr. A grid track sized 1fr floors
     * at min-content, so the widest row would push the track — and the page —
     * wider instead of letting the table scroll. Same failure that made the
     * whole page slide sideways, one layout system over.
     */
    <div
      className={
        selected
          ? 'grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]'
          : 'grid grid-cols-1'
      }
    >
      <div className="panel min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
        <WideTableScroll>
          <StatsDashboardTable
            rows={rows}
            totals={totals}
            breakdown={breakdown}
            sort={sort}
            direction={direction}
            sortHrefs={sortHrefs}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
        </WideTableScroll>
      </div>

      {selected ? (
        <RowDetail row={selected} breakdown={breakdown} onClose={() => setSelectedKey(null)} />
      ) : null}
    </div>
  );
}

function RowDetail({
  row,
  breakdown,
  onClose,
}: {
  row: DashboardRow;
  breakdown: Breakdown;
  onClose: () => void;
}) {
  const derived = derive(row);

  /*
   * Every column, in the sheet's own order and under the sheet's own section
   * headers, each with its letter. Read down instead of across — and because it
   * is generated from the same COLUMNS list the table uses, the panel cannot
   * come to disagree with the row it is describing.
   */
  let cursor = 0;
  const groups = SECTIONS.map((section) => {
    const columns = COLUMNS.slice(cursor, cursor + section.span);
    cursor += section.span;
    return { label: section.label, columns };
  }).filter((group) => group.label !== '');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-fg-subtle">
          Row detail
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close row detail"
          className="rounded-md border border-line p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>

      <Inspector
        title={row.clientName ?? '—'}
        subtitle={
          breakdown === 'client'
            ? 'All campaigns'
            : (row.campaignName ?? '(no campaign)')
        }
        status={row.status ?? undefined}
        metrics={[
          { label: 'spent', value: formatMoney(row.spendCents) },
          { label: 'leads', value: row.leads.toLocaleString() },
          {
            label: 'CPL',
            value:
              derived.cpl === null ? '—' : formatMoney(Math.round(derived.cpl * 100)),
            accent: true,
          },
        ]}
      >
        {groups.map((group) => (
          <InspectorSection key={group.label} title={group.label}>
            <dl className="space-y-1.5 text-sm">
              {group.columns.map((column) => {
                const blocked = column.blockedAt?.(breakdown) ?? false;
                const body = blocked
                  ? null
                  : (RENDERERS[column.letter]?.(row, derived) ?? null);

                return (
                  <div key={column.letter} className="flex justify-between gap-3">
                    <dt className="text-fg-subtle">
                      {column.heading}
                      <span className="numeric ml-1.5 text-[10px] text-fg-subtle/60">
                        {column.letter}
                      </span>
                    </dt>
                    <dd className="numeric shrink-0 text-fg">
                      {/*
                        Three states, not two. A value; a blank where the number
                        exists but has no denominator; and "no campaign source"
                        where this grain cannot answer at all — which is what the
                        hatching in the table means, said in words here because
                        there is room for words.
                      */}
                      {blocked ? (
                        <span className="text-[11px] text-fg-subtle">
                          no campaign source
                        </span>
                      ) : column.noSource ? (
                        <span className="text-[11px] text-fg-subtle">not recorded</span>
                      ) : (
                        (body ?? <span className="text-fg-subtle">—</span>)
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </InspectorSection>
        ))}
      </Inspector>

      {/*
        The panel is a dead end without this. Every figure here is about one
        practice, and the questions it raises — what else are they running, what
        has been billed, who is on their account — are all answered on their
        client page. Rendered only when the row carries a group id: campaign
        rows from the call feed alone have none, and a link to /clients/null is
        worse than no link.
      */}
      {row.groupId ? (
        <Link
          href={`/clients/${row.groupId}`}
          className="block rounded-md border border-line bg-surface px-3 py-2 text-center text-xs font-medium text-accent hover:bg-surface-hover"
        >
          Open {row.clientName ?? 'this practice'} in Client Management →
        </Link>
      ) : null}

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-md border border-line px-3 py-1.5 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
      >
        Close
      </button>
    </div>
  );
}
