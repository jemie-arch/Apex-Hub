import { TriangleAlert } from 'lucide-react';

import { ClientPicker } from '@/components/cft/ClientPicker';
import { StatsDashboardTable } from '@/components/cft/StatsDashboardTable';
import { WideTableScroll } from '@/components/cft/WideTableScroll';
import { CPL_BANDS, CPL_COLOUR_BANDS_ENABLED } from '@/config/cft-dashboard';
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

function Finding({
  severity,
  title,
  children,
}: {
  severity: 'blocking' | 'corrected' | 'structural' | 'no source' | 'minor';
  title: string;
  children: React.ReactNode;
}) {
  const tone = {
    blocking: 'bg-negative-subtle text-negative',
    corrected: 'bg-positive-subtle text-positive',
    structural: 'bg-warning-subtle text-warning',
    'no source': 'bg-neutral-subtle text-fg-muted',
    minor: 'bg-neutral-subtle text-fg-muted',
  }[severity];

  return (
    <div className="grid grid-cols-[104px_1fr] border-b border-line last:border-0">
      <div
        className={`px-3 py-3 text-[10px] uppercase tracking-widest ${tone} border-r border-line`}
      >
        {severity}
      </div>
      <div className="px-4 py-3">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{children}</p>
      </div>
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

      {stale ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-line bg-warning-subtle px-4 py-3">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
          <div className="text-xs text-warning">
            <p className="font-medium">
              Three of the four feeds behind this table have stopped, while ad
              spend keeps arriving.
            </p>
            <p className="mt-1">
              Last day with spend {day(freshness.spend)} · leads{' '}
              {day(freshness.leads)} · appointments {day(freshness.appts)} · calls{' '}
              {day(freshness.calls)}. Any window reaching past those dates shows
              real money against zero appointments, so Schedule %, Show %, Cost
              Per Booking and Cost Per Show all read far worse than the truth.
              Fix the feeds before anyone reads a CPL off this screen.
            </p>
          </div>
        </div>
      ) : null}

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

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fg-muted">
            {CPL_COLOUR_BANDS_ENABLED ? (
              CPL_BANDS.map((band) => (
                <span key={band.from}>
                  <span
                    className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-[-1px] ${
                      { positive: 'bg-positive', warning: 'bg-warning', negative: 'bg-negative', neutral: 'bg-fg-subtle' }[
                        band.tone
                      ]
                    }`}
                  />
                  CPL {band.to === null ? `$${band.from} and over` : `under $${band.to}`}
                </span>
              ))
            ) : (
              <span>
                CPL colour bands are off while leads are undercounted — with the
                denominator too small almost every client would paint red.
              </span>
            )}
            <span className="ml-auto">
              <span className="cft-blocked mr-1.5 inline-block h-2.5 w-2.5 rounded-sm border border-line-strong align-[-1px]" />
              hatched = no campaign-grain source
            </span>
          </div>

          <p className="numeric mt-2 text-[11px] text-fg-subtle">
            {formatCount(result.rows.length)} row(s) · columns A–E frozen · scroll
            sideways from either bar, above the table or below it · 33 columns, A to
            AG
          </p>
        </>
      )}

      <h2 className="mb-2 mt-8 text-sm font-semibold text-fg">Data integrity</h2>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <Finding severity="blocking" title="Leads, appointments and calls have all stopped arriving">
          Spend has no gap. Every appointment-derived and call-derived figure
          above is truncated at {day(freshness.appts)} and {day(freshness.calls)},
          so any window shorter than about two weeks is empty of everything but
          spend.
        </Finding>
        <Finding severity="blocking" title="Windsor returns 0 leads for 30 of 32 ad accounts">
          A per-account configuration fault, not an absence of leads — only
          Lightning Orthodontics and Tamara Levit report through Windsor. Diff a
          working account against a zero account rather than reconfiguring
          everything. The view falls back to <code>greatest(windsor, tracker)</code>,
          so CPL reads high because the denominator is wrong, not the spend.
        </Finding>
        <Finding severity="corrected" title="Pickup % exceeded 100% on 14 accounts">
          Connected calls were counted in both directions against an
          outbound-only denominator. <code>connected_outbound</code> restricts
          the numerator, so the ratio can no longer exceed 1. But the corrected
          figures sit at 98–100% for everyone, because <code>calls.outcome</code>{' '}
          is <code>connected</code> on 6,706 of 6,952 rows — the arithmetic is
          right and the field underneath still carries no signal.
        </Finding>
        <Finding severity="corrected" title="Speed to lead read in thousands of minutes">
          Values above 1,440 minutes are excluded from both the sum and the count
          and reported separately, shown in brackets beside the average, so a few
          stale <code>lead_created_at</code> timestamps no longer swamp it. A
          large bracket means the timestamps need fixing, not that the team is
          slow.
        </Finding>
        <Finding severity="structural" title="Call data cannot be broken down by campaign">
          The <code>calls</code> table carries no campaign reference and{' '}
          <code>calls.deal_id</code> is null on all 6,952 rows, so columns J–O
          are hatched in the Campaign breakdown. Switch to Client to read them.
          Repeating the client total on every campaign row would double count.
        </Finding>
        {result.dialledWithoutCampaign.length > 0 ? (
          <Finding
            severity="structural"
            title={`${result.dialledWithoutCampaign.length} client(s) are being dialled with no live campaign`}
          >
            {result.dialledWithoutCampaign
              .map((entry) => `${entry.name} (${entry.dials})`)
              .join(', ')}{' '}
            — outbound dials in this window against zero spend, zero leads and
            zero appointments. Either their campaigns are missing an{' '}
            <code>ad_account_id</code>, or the team is working a list that no
            longer has ads behind it. They appear in the Client breakdown with an
            empty Ad data section rather than being dropped.
          </Finding>
        ) : null}
        <Finding severity="no source" title="Notes, Revenue and ROI have nowhere to come from">
          Notes is typed by hand in the sheet. Revenue means patient case value,
          which the Hub records nowhere — <code>billing_charges</code> holds what
          Apex charges per consult, a different quantity, so it is deliberately
          not substituted, and ROI depends on it. Closes are real:{' '}
          <code>status_if_showed = &apos;Closed&apos;</code>.
        </Finding>
        <Finding severity="minor" title="Two smaller discrepancies">
          Cancels come from <code>appointment_ledger.cancelled_at</code> joined
          back to the tracker row; 40 of 113 join, the other 73 are CRM-only rows
          with no campaign. And 118 of 1,281 tracker appointments carry no
          campaign id — they appear as rows with a blank campaign name rather
          than being dropped.
        </Finding>
      </div>
    </>
  );
}
