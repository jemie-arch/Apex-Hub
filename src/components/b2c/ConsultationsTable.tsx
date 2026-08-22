'use client';

/**
 * Consultations on the left, the one you clicked on the right.
 *
 * The same split as ads and fulfilment. Here the inspector earns its place for a
 * different reason: the table has to stay narrow enough to scan a hundred rows,
 * so attribution, contact details and timings have nowhere to live in the row
 * itself. They are the reason somebody opens a consultation at all.
 *
 * The filters are the four questions worth asking of a day's list, and
 * "Unmarked" is first among equals — an appointment nobody marked up cannot be
 * billed and is invisible in every rate on the page.
 */
import { BadgeDollarSign } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';
import { FilterPills } from '@/components/ui/FilterPills';
import { Inspector, InspectorSection } from '@/components/ui/Inspector';
import {
  StatusPill,
  appointmentStatusTone,
  outcomeTone,
} from '@/components/ui/StatusPill';
import { cn } from '@/lib/cn';
import { formatCount, formatDateTimeInZone, formatMoney, humanise, zoneAbbreviation } from '@/lib/format';

export interface ConsultationRow {
  id: string;
  clientId: string;
  patientName: string | null;
  scheduledAt: string;
  status: string;
  showed: boolean | null;
  outcome: string;
  valueCents: number | null;
  bookedByName: string | null;
  attributionSource: string | null;
  clientName: string;
  groupId: string | null;
  groupName: string;
  timezone: string;
}

type Filter = 'all' | 'attended' | 'missed' | 'unmarked';

export function ConsultationsTable({
  rows,
  patientNoun,
  clientNoun,
  bookingPlural,
}: {
  rows: ConsultationRow[];
  patientNoun: string;
  clientNoun: string;
  bookingPlural: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);

  const counts = useMemo(
    () => ({
      all: rows.length,
      attended: rows.filter((row) => row.showed === true).length,
      missed: rows.filter((row) => row.showed === false).length,
      unmarked: rows.filter((row) => row.showed === null).length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    if (filter === 'attended') return rows.filter((row) => row.showed === true);
    if (filter === 'missed') return rows.filter((row) => row.showed === false);
    if (filter === 'unmarked') return rows.filter((row) => row.showed === null);
    return rows;
  }, [rows, filter]);

  const selected = rows.find((row) => row.id === selectedId) ?? visible[0] ?? null;

  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No ${bookingPlural} in this period`}
        description="Widen the date range, or run the CRM sync if nothing has come in yet."
        icon={<BadgeDollarSign size={22} />}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
      <section className="panel overflow-hidden rounded-lg border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              {formatCount(visible.length)} {bookingPlural}
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
              { key: 'attended', label: 'Attended', count: counts.attended },
              { key: 'missed', label: 'No show', count: counts.missed },
              { key: 'unmarked', label: 'Unmarked', count: counts.unmarked },
            ]}
          />
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">{patientNoun}</th>
                <th className="px-4 py-2.5 font-medium">{clientNoun}</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const isSelected = selected?.id === row.id;

                return (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(row.id);
                      }
                    }}
                    className={cn(
                      'row-interactive cursor-pointer border-b border-line last:border-0 focus:outline-none',
                      isSelected
                        ? 'bg-accent-subtle/40 shadow-[inset_2px_0_0_0_var(--accent)]'
                        : 'hover:bg-surface-hover',
                    )}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-fg-muted">
                      {formatDateTimeInZone(row.scheduledAt, row.timezone)}
                      <span className="ml-1.5 text-[11px] text-fg-subtle">
                        {zoneAbbreviation(row.timezone)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-fg">
                      {row.patientName ?? (
                        <span className="font-normal text-fg-subtle">
                          not yet enriched
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted">{row.groupName}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill
                        value={row.status}
                        tone={appointmentStatusTone(row.status)}
                      />
                    </td>
                    <td className="numeric px-4 py-2.5 text-right text-fg-muted">
                      {row.valueCents ? formatMoney(row.valueCents) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {visible.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-fg-subtle">
              Nothing matches this filter.
            </p>
          ) : null}
        </div>
      </section>

      {selected ? <Detail row={selected} /> : null}
    </div>
  );
}

function Detail({ row }: { row: ConsultationRow }) {
  return (
    <Inspector
      title={row.patientName ?? 'Name not yet enriched'}
      subtitle={row.clientName}
      status={
        row.showed === true ? 'Attended' : row.showed === false ? 'No show' : 'Unmarked'
      }
      metrics={[
        {
          label: 'status',
          value: humanise(row.status),
        },
        {
          label: 'outcome',
          value: row.outcome === 'pending' ? '—' : humanise(row.outcome),
          accent: row.outcome !== 'pending',
        },
        {
          label: 'value',
          value: row.valueCents ? formatMoney(row.valueCents) : '—',
        },
      ]}
    >
      <InspectorSection title="When">
        <p className="text-sm text-fg">
          {formatDateTimeInZone(row.scheduledAt, row.timezone)}{' '}
          <span className="text-fg-subtle">{zoneAbbreviation(row.timezone)}</span>
        </p>
        <p className="mt-1 text-[11px] text-fg-subtle">
          Shown in the practice&rsquo;s own timezone, because a 9am appointment is
          9am where the patient is going.
        </p>
      </InspectorSection>

      <InspectorSection title="Outcome">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill value={row.outcome} tone={outcomeTone(row.outcome)} />
        </div>
        {row.outcome === 'pending' ? (
          <p className="mt-2 text-[11px] text-warning">
            Still the value this row was created with, so nobody has recorded what
            happened. It cannot count as won or lost until they do.
          </p>
        ) : null}
      </InspectorSection>

      <InspectorSection title="Where it came from">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-subtle">Booked by</dt>
            <dd className="text-fg-muted">
              {row.bookedByName ?? <span className="text-fg-subtle">unknown</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-subtle">Source</dt>
            <dd className="text-fg-muted">
              {row.attributionSource ?? (
                <span className="text-fg-subtle">none recorded</span>
              )}
            </dd>
          </div>
        </dl>
        {row.attributionSource === null ? (
          <p className="mt-2 text-[11px] text-fg-subtle">
            No attribution on this booking, which is true of nearly all of them —
            the UTM template is not reaching GoHighLevel.
          </p>
        ) : null}
      </InspectorSection>

      {row.groupId ? (
        <Link
          href={`/clients/${row.groupId}`}
          className="block text-xs text-accent hover:underline"
        >
          Open {row.groupName} →
        </Link>
      ) : null}
    </Inspector>
  );
}
