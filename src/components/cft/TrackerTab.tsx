import { ClientPicker } from '@/components/cft/ClientPicker';
import { StatsDashboardTable } from '@/components/cft/StatsDashboardTable';
import { WideTableScroll } from '@/components/cft/WideTableScroll';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterPillLinks } from '@/components/ui/FilterPills';
import { COLUMNS } from '@/lib/cft-columns';
import {
  type Breakdown,
  WINDOWS,
  type WindowDays,
  derive,
  loadStatsDashboard,
  sortRows,
} from '@/lib/cft-stats';
import { formatCount, formatMoney, formatPercent } from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

/**
 * The STATS DASHBOARD tab of the Client Fulfilment Tracker, in the Hub.
 *
 * Three controls matching the spreadsheet's own — window, breakdown, client —
 * plus sorting, all held in the URL so a view can be sent to somebody and the
 * page keeps rendering on the server.
 */

/** How stale each feed is, measured rather than written down. */
async function feedFreshness(db: ReturnType<typeof serviceClient>) {
  const latest = async (
    view: 'v_cft_stats_dashboard' | 'v_cft_call_daily',
    column: string,
  ): Promise<string | null> => {
    const { data } = await db
      .from(view)
      .select('day')
      .gt(column, 0)
      .order('day', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { day: string } | null)?.day ?? null;
  };

  const [spend, leads, appts, calls] = await Promise.all([
    latest('v_cft_stats_dashboard', 'spend_cents'),
    latest('v_cft_stats_dashboard', 'leads_best'),
    latest('v_cft_stats_dashboard', 'appts_created'),
    latest('v_cft_call_daily', 'dialed_calls'),
  ]);

  return { spend, leads, appts, calls };
}

const day = (value: string | null): string =>
  value === null
    ? 'never'
    : new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      });

function Kpi({
  label,
  value,
  note,
  stale,
}: {
  label: string;
  value: string;
  note: string;
  stale?: boolean;
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="text-[10px] uppercase tracking-widest text-fg-subtle">{label}</p>
      <p className="numeric mt-1 text-2xl font-semibold text-fg">{value}</p>
      <p className={stale ? 'mt-0.5 text-xs font-medium text-warning' : 'mt-0.5 text-xs text-fg-muted'}>
        {note}
      </p>
    </div>
  );
}

export async function TrackerTab({
  searchParams,
  basePath,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  /** The page hosting the tab, so its own controls link back to it. */
  basePath: string;
}) {
  const single = (key: string): string | undefined => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  /*
   * Hrefs are built here, on the server, and handed to the pills as strings.
   * FilterPillLinks is a client component and a builder function cannot cross
   * that boundary — the component's own comment records the render-time error
   * that taught the codebase this.
   */
  const href = (next: Record<string, string>): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      const flat = Array.isArray(value) ? value[0] : value;
      if (flat) params.set(key, flat);
    }
    for (const [key, value] of Object.entries(next)) params.set(key, value);
    params.set('tab', 'tracker');
    return `${basePath}?${params.toString()}`;
  };

  /*
   * Thirty days by default, not the sheet's three.
   *
   * The sheet opens on Last 3 Days, and mirroring that exactly would be the
   * purer choice — but leads, appointments and calls have all stopped while
   * spend keeps arriving, so a three-day window is spend against zeroes for
   * every client. A mirror whose first screen is empty teaches people the page
   * is broken. The sheet's default is named beside the control instead.
   */
  const days = (WINDOWS.find((option) => String(option) === single('win')) ??
    30) as WindowDays;
  const breakdown: Breakdown = single('bd') === 'client' ? 'client' : 'campaign';
  const clientId = single('client') !== '' ? single('client') : undefined;

  const sortParam = Number(single('sort'));
  const sort =
    Number.isInteger(sortParam) && sortParam >= 0 && sortParam < COLUMNS.length
      ? sortParam
      : null;
  const direction = single('dir') === 'asc' ? 'asc' : 'desc';

  const db = serviceClient();

  const [result, freshness] = await Promise.all([
    loadStatsDashboard(db, { days, breakdown, clientId }),
    feedFreshness(db),
  ]);

  // Clicking the sorted column flips it; clicking another starts descending,
  // which is what somebody scanning for the biggest number expects.
  const hrefForSort = (index: number): string =>
    href({
      sort: String(index),
      dir: sort === index && direction === 'desc' ? 'asc' : 'desc',
    });

  const rows =
    sort === null
      ? result.rows
      : sortRows(result.rows, (row) => COLUMNS[sort]!.value(row, derive(row)), direction);

  const totals = derive(result.totals);

  /*
   * The banner exists for one specific failure, not as general hedging: ad
   * spend arrives daily while three feeds have stopped, so a short window shows
   * real money against zero everything and every appointment-derived figure
   * reads far worse than the truth. Dates are measured on each render rather
   * than written into the copy, so it goes quiet by itself once feeds resume.
   */
  const stale =
    freshness.spend !== null &&
    (freshness.appts === null || freshness.appts < freshness.spend);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterPillLinks
          options={WINDOWS.map((option) => ({
            key: String(option),
            label: `Last ${option} Days`,
            href: href({ win: String(option) }),
          }))}
          value={String(days)}
        />
        <FilterPillLinks
          options={[
            { key: 'campaign', label: 'Campaign', href: href({ bd: 'campaign' }) },
            { key: 'client', label: 'Client', href: href({ bd: 'client' }) },
          ]}
          value={breakdown}
        />
        <ClientPicker clients={result.clients} />
        <span className="numeric ml-auto text-right text-[10px] leading-relaxed text-fg-subtle">
          {result.from} to {result.to}
          <br />
          sheet controls D1 · D2 · D3 — its default is Last 3 Days
        </span>
      </div>

      {result.rows.length === 0 ? (
        <EmptyState
          title="Nothing in this window"
          description="No spend, leads, appointments or calls landed in the selected range."
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
            <Kpi
              label="Amount spent"
              value={formatMoney(result.totals.spendCents)}
              note={`${formatCount(result.rows.length)} ${breakdown} row(s)`}
            />
            <Kpi
              label="Leads"
              value={formatCount(result.totals.leads)}
              note="Windsor reports 0 for 30 of 32 accounts"
              stale={result.totals.leads === 0}
            />
            <Kpi
              label="CPL"
              value={totals.cpl === null ? '—' : formatMoney(Math.round(totals.cpl * 100))}
              note="spend ÷ leads, over the whole window"
            />
            <Kpi
              label="Appointments"
              value={formatCount(result.totals.apptsCreated)}
              note={`last one ${day(freshness.appts)}`}
              stale={stale}
            />
            <Kpi
              label="Shows"
              value={formatCount(result.totals.shows)}
              note={`${formatPercent(totals.showPct, 1)} of appointments`}
            />
            <Kpi
              label="Closes"
              value={formatCount(result.totals.closes)}
              note={`${formatPercent(totals.closePct, 1)} of shows`}
            />
          </div>

          <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
            <WideTableScroll>
              <StatsDashboardTable
                rows={rows}
                totals={result.totals}
                breakdown={breakdown}
                sort={sort}
                direction={direction}
                hrefForSort={hrefForSort}
              />
            </WideTableScroll>
          </div>

        </>
      )}

    </>
  );
}
