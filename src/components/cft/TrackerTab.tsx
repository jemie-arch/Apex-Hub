import { ClientPicker } from '@/components/cft/ClientPicker';
import { StatsDashboard } from '@/components/cft/StatsDashboard';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterPillLinks } from '@/components/ui/FilterPills';
import { CPL_COLOUR_BANDS_ON_KPI, cplTone } from '@/config/cft-dashboard';
import { COLUMNS } from '@/lib/cft-columns';
import {
  type Breakdown,
  WINDOWS,
  type WindowDays,
  derive,
  loadStatsDashboard,
  sortRows,
} from '@/lib/cft-stats';
import { cn } from '@/lib/cn';
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

type Tone = 'positive' | 'warning' | 'negative' | 'neutral';

const VALUE_TONE: Record<Tone, string> = {
  positive: 'text-positive',
  warning: 'text-warning',
  negative: 'text-negative',
  neutral: 'text-fg',
};

/**
 * One headline figure.
 *
 * The colour sits on the number and on a rule down the left edge, not on the
 * whole card. Six coloured cards in a row compete with each other and none of
 * them reads as a warning; a coloured figure against a plain card does.
 */
function Kpi({
  label,
  value,
  note,
  tone = 'neutral',
  noteTone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: Tone;
  noteTone?: Tone;
}) {
  return (
    <div
      className={cn(
        'bg-surface px-4 py-3',
        tone !== 'neutral' && 'border-l-2',
        tone === 'positive' && 'border-positive',
        tone === 'warning' && 'border-warning',
        tone === 'negative' && 'border-negative',
      )}
    >
      <p className="text-[10px] uppercase tracking-widest text-fg-subtle">{label}</p>
      <p className={cn('numeric mt-1 text-2xl font-semibold', VALUE_TONE[tone])}>
        {value}
      </p>
      <p
        className={cn(
          'mt-0.5 text-xs',
          noteTone && noteTone !== 'neutral'
            ? `font-medium ${VALUE_TONE[noteTone]}`
            : 'text-fg-muted',
        )}
      >
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
              note={
                freshness.leads === null
                  ? 'no leads recorded at all'
                  : `last one ${day(freshness.leads)} · Windsor reports 0 for 30 of 32 accounts`
              }
              tone={result.totals.leads === 0 ? 'negative' : 'neutral'}
              noteTone="warning"
            />
            {/*
              The one figure carrying Joshua's colour bands. Per-row bands stay
              off: with leads undercounted forty rows would paint red and read as
              a broken page rather than a ranking. One banded figure with the
              undercount named beneath it is a reading somebody can weigh.
            */}
            <Kpi
              label="CPL"
              value={totals.cpl === null ? '—' : formatMoney(Math.round(totals.cpl * 100))}
              note="spend ÷ leads · band assumes leads are complete, and they are not"
              tone={cplTone(totals.cpl, CPL_COLOUR_BANDS_ON_KPI) ?? 'neutral'}
              noteTone="warning"
            />
            <Kpi
              label="Appointments"
              value={formatCount(result.totals.apptsCreated)}
              note={`last one ${day(freshness.appts)}`}
              tone={stale ? 'warning' : 'neutral'}
              noteTone={stale ? 'warning' : 'neutral'}
            />
            {/*
              Shows and Closes carry no band. Nobody has agreed a good show rate
              or a good close rate, and inventing thresholds here would be the
              same mistake as assuming a band above $25 CPL — a colour reads as
              a judgement whether or not one was made.
            */}
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

          <StatsDashboard
            rows={rows}
            totals={result.totals}
            breakdown={breakdown}
            sort={sort}
            direction={direction}
            sortHrefs={COLUMNS.map((_column, index) => hrefForSort(index))}
          />

        </>
      )}

    </>
  );
}
