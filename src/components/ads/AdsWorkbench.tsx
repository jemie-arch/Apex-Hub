'use client';

/**
 * Ads management: a ranked list of practices, and an inspector for the one
 * you clicked.
 *
 * Laid out the way the reference is — an eyebrow and a plain-language headline,
 * four summary tiles, then a table on the left and a dark inspector on the
 * right. What changed is what the rows are: practices, not campaigns, because
 * "which client's ads are working" is the question, and a campaign name is only
 * how Meta files it.
 *
 * The columns are limited to what the data can answer. No clicks and no revenue
 * anywhere on this page: the imported ad data carries spend and leads per ad per
 * day and no impressions or clicks, and case value is recorded nowhere. Cost per
 * booking replaces return on ad spend and needs only figures that exist.
 */
import { ArrowDownRight, ArrowUpRight, Megaphone, Minus, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';
import { Sparkline } from '@/components/ui/Sparkline';
import { cn } from '@/lib/cn';
import { formatCount, formatMoney, formatMoneyCompact, formatPercent } from '@/lib/format';

export interface AdsTopAd {
  id: string;
  name: string;
  spendCents: number;
  leads: number;
}

export interface AdsClientRow {
  id: string;
  name: string;
  status: string;
  spendCents: number;
  previousSpendCents: number;
  leads: number;
  booked: number;
  showed: number;
  noShow: number;
  closed: number;
  dailySpend: number[];
  topAds: AdsTopAd[];
}

type Filter = 'all' | 'spending' | 'quiet';

function costPerBooking(row: AdsClientRow): number | null {
  if (row.spendCents === 0 || row.booked === 0) return null;
  return Math.round(row.spendCents / row.booked);
}

/**
 * Of the bookings that have actually been decided, how many turned up.
 *
 * Divided by showed plus no-show, not by everything booked. Dividing by all
 * bookings counts next Tuesday's appointment as a failure to show, which drags
 * the rate down for exactly the practices booking well.
 */
function showRate(row: AdsClientRow): number | null {
  const settled = row.showed + row.noShow;
  return settled === 0 ? null : row.showed / settled;
}

/** Change in spend against the preceding period of equal length. */
function spendDelta(row: AdsClientRow): number | null {
  if (row.previousSpendCents === 0) return null;
  return (row.spendCents - row.previousSpendCents) / row.previousSpendCents;
}

function DeltaTag({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-[11px] text-fg-subtle">new</span>;
  }

  const flat = Math.abs(value) < 0.005;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[11px] font-medium',
        // Spend going up is not good news by itself, so this is neutral-toned
        // rather than green: it reports a direction, not a verdict.
        flat ? 'text-fg-subtle' : 'text-fg-muted',
      )}
    >
      <Icon size={11} />
      {formatPercent(Math.abs(value), 0)}
    </span>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  series,
  tone = 'accent',
}: {
  label: string;
  value: string;
  hint: string;
  series: number[];
  tone?: 'accent' | 'positive' | 'negative';
}) {
  return (
    <div className="surface-3d rounded-lg border border-line bg-surface p-4">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="numeric text-2xl font-semibold tracking-tight text-fg">
            {value}
          </p>
          <p className="mt-1 text-[11px] text-fg-subtle">{hint}</p>
        </div>
        <Sparkline points={series} tone={tone} width={104} height={34} />
      </div>
    </div>
  );
}

export function AdsWorkbench({
  rows,
  days,
  rangeLabel,
  controls,
}: {
  rows: AdsClientRow[];
  days: string[];
  rangeLabel: string;
  controls: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);

  const totals = useMemo(() => {
    const spendCents = rows.reduce((sum, row) => sum + row.spendCents, 0);
    const leads = rows.reduce((sum, row) => sum + row.leads, 0);
    const booked = rows.reduce((sum, row) => sum + row.booked, 0);
    const showed = rows.reduce((sum, row) => sum + row.showed, 0);

    const dailySpend = days.map((_, index) =>
      rows.reduce((sum, row) => sum + (row.dailySpend[index] ?? 0), 0),
    );

    return { spendCents, leads, booked, showed, dailySpend };
  }, [rows, days]);

  /**
   * The practice getting the most for its money.
   *
   * Requires at least five bookings: a client with one booking and a low spend
   * shows an unbeatable cost per booking that would evaporate on the sixth.
   */
  const best = useMemo(() => {
    const eligible = rows
      .filter((row) => row.booked >= 5 && row.spendCents > 0)
      .map((row) => ({ row, cost: costPerBooking(row) ?? Infinity }))
      .sort((a, b) => a.cost - b.cost);
    return eligible[0] ?? null;
  }, [rows]);

  const visible = useMemo(() => {
    if (filter === 'spending') return rows.filter((row) => row.spendCents > 0);
    if (filter === 'quiet') return rows.filter((row) => row.spendCents === 0);
    return rows;
  }, [rows, filter]);

  const selected =
    rows.find((row) => row.id === selectedId) ?? visible[0] ?? rows[0] ?? null;

  const spendingCount = rows.filter((row) => row.spendCents > 0).length;
  const overallCost =
    totals.booked > 0 && totals.spendCents > 0
      ? Math.round(totals.spendCents / totals.booked)
      : null;

  if (rows.length === 0) {
    return (
      <>
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              Ads
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">
              Nothing ran in this period
            </h1>
          </div>
          {controls}
        </header>
        <EmptyState
          title="No ad spend and no bookings"
          description="Widen the range, or check that the ad data has been imported."
          icon={<Megaphone size={22} />}
        />
      </>
    );
  }

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            Ads
            <span className="inline-flex items-center gap-1.5 rounded-full bg-positive-subtle px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-positive">
              <span className="h-1.5 w-1.5 rounded-full bg-positive" aria-hidden />
              {formatCount(spendingCount)} spending
            </span>
          </p>

          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-fg">
            What&rsquo;s actually working
          </h1>

          <p className="mt-1.5 text-sm text-fg-muted">
            {rangeLabel} · {formatCount(rows.length)} practices ·{' '}
            <span className="text-accent">
              {formatMoney(totals.spendCents)} spent
            </span>{' '}
            for {formatCount(totals.booked)} bookings
            {overallCost !== null ? (
              <>
                {' '}
                at {formatMoney(overallCost)} each
              </>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">{controls}</div>
      </header>

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="Ad spend"
          value={formatMoneyCompact(totals.spendCents)}
          hint={`${formatCount(spendingCount)} practices with spend`}
          series={totals.dailySpend}
        />
        <SummaryTile
          label="Bookings"
          value={formatCount(totals.booked)}
          hint={`${formatCount(totals.showed)} showed up`}
          series={rows.map((row) => row.booked).slice(0, 24)}
          tone="positive"
        />
        <SummaryTile
          label="Cost per booking"
          value={overallCost === null ? '—' : formatMoney(overallCost)}
          hint={
            overallCost === null
              ? 'needs spend and bookings'
              : 'spend divided by bookings'
          }
          series={rows
            .map((row) => costPerBooking(row))
            .filter((cost): cost is number => cost !== null)
            .slice(0, 24)}
        />

        <div className="surface-3d rounded-lg border border-accent-subtle bg-surface p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent">
            <Star size={12} /> Best value
          </p>
          {best === null ? (
            <p className="mt-2 text-xs text-fg-subtle">
              Nobody has five bookings in this period yet, and ranking on fewer
              than that rewards a fluke.
            </p>
          ) : (
            <>
              <p className="mt-2 truncate text-sm font-medium text-fg">
                {best.row.name}
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                {formatMoney(best.cost)} per booking ·{' '}
                {formatCount(best.row.booked)} booked
              </p>
              <button
                type="button"
                onClick={() => setSelectedId(best.row.id)}
                className="mt-3 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-contrast transition-opacity hover:opacity-90"
              >
                Inspect
              </button>
            </>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <section className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-fg">All practices</h2>
              <p className="text-xs text-fg-subtle">
                Click a row to inspect it on the right
              </p>
            </div>

            <div className="flex rounded-md border border-line p-0.5">
              {(
                [
                  ['all', 'All'],
                  ['spending', 'Spending'],
                  ['quiet', 'No spend'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs transition-colors',
                    filter === key
                      ? 'bg-accent-subtle font-medium text-accent'
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-2.5 font-medium">Client</th>
                  <th className="px-4 py-2.5 text-right font-medium">Spend</th>
                  <th className="px-4 py-2.5 text-right font-medium">Leads</th>
                  <th className="px-4 py-2.5 text-right font-medium">Booked</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cost / booking</th>
                  <th className="px-4 py-2.5 text-right font-medium">Share · Δ</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const cost = costPerBooking(row);
                  const share =
                    totals.spendCents === 0 ? 0 : row.spendCents / totals.spendCents;
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
                      <td className="px-4 py-2.5">
                        <span className="block truncate font-medium text-fg">
                          {row.name}
                        </span>
                        <span className="block text-[11px] text-fg-subtle">
                          {row.spendCents > 0
                            ? `${formatCount(row.topAds.length)} ads with spend`
                            : 'no spend in period'}
                        </span>
                      </td>
                      <td className="numeric px-4 py-2.5 text-right text-fg">
                        {row.spendCents > 0 ? formatMoney(row.spendCents) : '—'}
                      </td>
                      <td className="numeric px-4 py-2.5 text-right text-fg-muted">
                        {row.leads > 0 ? formatCount(row.leads) : '—'}
                      </td>
                      <td className="numeric px-4 py-2.5 text-right text-fg-muted">
                        {row.booked > 0 ? formatCount(row.booked) : '—'}
                      </td>
                      <td className="numeric px-4 py-2.5 text-right text-fg-muted">
                        {cost === null ? '—' : formatMoney(cost)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1 w-14 overflow-hidden rounded-full bg-chart-track">
                            <div
                              className="h-full rounded-full bg-accent transition-all duration-500"
                              style={{ width: `${Math.round(share * 100)}%` }}
                            />
                          </div>
                          <DeltaTag value={spendDelta(row)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {visible.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-fg-subtle">
                No practice matches this filter.
              </p>
            ) : null}
          </div>
        </section>

        {selected ? <Inspector row={selected} days={days} /> : null}
      </div>

      <p className="mt-4 text-xs text-fg-subtle">
        No clicks or impressions column: the imported ad data carries spend and
        leads per ad per day and nothing finer, so click-through and cost per
        click cannot be worked out. Cost per booking stands in for return on ad
        spend, which needs a case value nobody records.
      </p>
    </>
  );
}

/**
 * The dark panel on the right.
 *
 * Kept visually distinct from the table rather than matching it, because it is a
 * different mode: the table is the whole picture, this is one practice held up
 * to the light.
 */
function Inspector({ row, days }: { row: AdsClientRow; days: string[] }) {
  const cost = costPerBooking(row);
  const rate = showRate(row);
  const first = days[0];
  const last = days[days.length - 1];

  const funnel = [
    { label: 'Leads', value: row.leads, tone: 'bg-chart-6' },
    { label: 'Booked', value: row.booked, tone: 'bg-accent' },
    { label: 'Showed', value: row.showed, tone: 'bg-positive' },
    { label: 'Closed', value: row.closed, tone: 'bg-chart-3' },
  ];
  const widest = Math.max(...funnel.map((step) => step.value), 1);

  return (
    <div className="space-y-4">
      <section className="surface-3d overflow-hidden rounded-lg border border-accent-subtle bg-surface-sunken p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            Inspecting
          </span>
          <span className="text-[11px] text-fg-subtle">
            {row.spendCents > 0 ? 'Spending' : 'Idle'}
          </span>
        </div>

        <h3 className="mt-2.5 truncate text-base font-semibold text-fg">
          {row.name}
        </h3>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <p className="numeric text-lg font-semibold text-fg">
              {row.spendCents > 0 ? formatMoneyCompact(row.spendCents) : '—'}
            </p>
            <p className="text-[11px] text-fg-subtle">spend</p>
          </div>
          <div>
            <p className="numeric text-lg font-semibold text-fg">
              {formatCount(row.booked)}
            </p>
            <p className="text-[11px] text-fg-subtle">booked</p>
          </div>
          <div>
            <p className="numeric text-lg font-semibold text-accent">
              {cost === null ? '—' : formatMoneyCompact(cost)}
            </p>
            <p className="text-[11px] text-fg-subtle">per booking</p>
          </div>
        </div>

        <div className="mt-3">
          <Sparkline
            points={row.dailySpend}
            width={340}
            height={64}
            className="w-full"
          />
          <div className="mt-1 flex justify-between text-[10px] text-fg-subtle">
            <span>{first}</span>
            <span>{last}</span>
          </div>
        </div>
      </section>

      <section className="panel rounded-lg border border-line bg-surface p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          Top ads
        </h4>

        {row.topAds.length === 0 ? (
          <p className="mt-2 text-xs text-fg-subtle">
            No ad carried spend for this practice in the period.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {row.topAds.map((ad) => (
              <li key={ad.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-fg-muted">
                  {ad.name}
                </span>
                <span className="numeric shrink-0 text-xs text-fg">
                  {formatMoney(ad.spendCents)}
                  {ad.leads > 0 ? (
                    <span className="ml-2 text-positive">
                      {formatCount(ad.leads)} leads
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel rounded-lg border border-line bg-surface p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
          Funnel
        </h4>

        <div className="mt-2.5 space-y-2">
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
              <span className="numeric w-10 shrink-0 text-right text-xs text-fg-muted">
                {formatCount(step.value)}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[11px] text-fg-subtle">
          {rate === null
            ? 'No show rate yet — nothing has been marked showed or missed.'
            : `${formatPercent(rate, 0)} of bookings showed up.`}
          {' '}
          Leads come from the ad platforms, the rest from the tracker, so the
          first bar counts a different thing from the three below it.
        </p>
      </section>
    </div>
  );
}
