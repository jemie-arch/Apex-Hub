import { TriangleAlert } from 'lucide-react';

import { ClientPicker } from '@/components/b2c/ClientPicker';
import { StatsDashboardTable } from '@/components/b2c/StatsDashboardTable';
import { WideTableScroll } from '@/components/b2c/WideTableScroll';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterPillLinks } from '@/components/ui/FilterPills';
import {
  type Breakdown,
  WINDOWS,
  type WindowDays,
  loadStatsDashboard,
} from '@/lib/cft-stats';
import { serviceClient } from '@/lib/supabase/service';

/**
 * The STATS DASHBOARD tab of the Client Fulfilment Tracker, in the Hub.
 *
 * Three controls, the same three the spreadsheet has: window, breakdown and
 * client. All three live in the URL, so a view can be sent to somebody.
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

export async function TrackerTab({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
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
    return `/b2c?${params.toString()}`;
  };

  /*
   * Three days by default, matching the spreadsheet. It is the least useful
   * window given the stopped feeds, and it is still the right default: this is
   * a mirror, and a mirror that quietly picks a different window than the sheet
   * would have people comparing two things that are not the same view.
   */
  const days = (WINDOWS.find((option) => String(option) === single('win')) ??
    3) as WindowDays;
  const breakdown: Breakdown = single('bd') === 'client' ? 'client' : 'campaign';
  const clientId = single('client') !== '' ? single('client') : undefined;

  const db = serviceClient();

  const [result, freshness] = await Promise.all([
    loadStatsDashboard(db, { days, breakdown, clientId }),
    feedFreshness(db),
  ]);

  /*
   * The banner exists because of a specific failure mode, not as general
   * hedging. Ad spend arrives daily; leads, appointments and calls have all
   * stopped. So the default three-day window shows real money against zero
   * everything, and every derived figure in it — CPL, Schedule %, Cost Per
   * Show — is either blank or absurd. A reader who does not know that concludes
   * the campaigns collapsed.
   *
   * Dates are measured from the views on every render rather than written into
   * the copy, so this stops being alarming by itself once the feeds resume.
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
        <span className="numeric ml-auto text-xs text-fg-subtle">
          {result.from} to {result.to}
        </span>
      </div>

      {stale ? (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-line bg-warning-subtle px-4 py-3">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
          <div className="text-xs text-warning">
            <p className="font-medium">
              Ad spend is current; leads, appointments and calls are not.
            </p>
            <p className="mt-1">
              Last day with spend {day(freshness.spend)} · leads{' '}
              {day(freshness.leads)} · appointments {day(freshness.appts)} · calls{' '}
              {day(freshness.calls)}. A window that reaches past those dates shows
              real money against zero appointments, so Schedule %, Show %, Cost
              Per Booking and Cost Per Show all read far worse than the truth.
              The campaigns have not collapsed — three feeds have stopped.
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
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <WideTableScroll>
            <StatsDashboardTable
              rows={result.rows}
              totals={result.totals}
              breakdown={breakdown}
            />
          </WideTableScroll>
        </div>
      )}

      <section className="mt-6 max-w-3xl space-y-1 text-xs text-fg-subtle">
        <p className="font-medium text-fg-muted">What these numbers cannot tell you</p>
        <p>
          <strong>Leads are undercounted.</strong> Windsor returns zero leads for
          30 of 32 ad accounts — a per-account configuration fault, not an absence
          of leads. The view falls back to the larger of Windsor and the tracker,
          which is why CPL reads high.
        </p>
        <p>
          <strong>Call data has no campaign grain.</strong> The calls table
          carries no campaign reference, so columns J to O are blank in the
          Campaign breakdown. Switch to Client to fill them in. They are not
          repeated across a client&rsquo;s campaign rows, because that would show
          the same calls several times.
        </p>
        <p>
          <strong>Pickup % carries no signal yet.</strong> It is arithmetically
          right, but calls.outcome is &ldquo;connected&rdquo; on 6,706 of 6,952
          rows, so every client reads 98–100%.
        </p>
        <p>
          <strong>Speed To Lead excludes values over 24 hours</strong>, which are
          counted separately and shown in brackets beside the average. A large
          bracket means stale lead timestamps, not a slow team.
        </p>
        <p>
          <strong>Notes, Revenue and ROI are blank.</strong> Notes is typed by
          hand in the sheet. Patient case value is recorded nowhere in the Hub,
          and billing_charges is agency revenue — a different quantity — so it is
          deliberately not substituted.
        </p>
        <p>
          <strong>118 of 1,281 tracker appointments carry no campaign id.</strong>{' '}
          They appear as rows with a blank campaign name rather than being
          filtered out.
        </p>
      </section>
    </>
  );
}
