import {
  AlertTriangle,
  CalendarCheck,
  CircleDollarSign,
  MousePointerClick,
  Target,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';

import { TrackerTab } from '@/components/cft/TrackerTab';
import { BarChart } from '@/components/ui/BarChart';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterPillLinks } from '@/components/ui/FilterPills';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import { HEALTH_TONE, getGroupRollups } from '@/lib/client-metrics';
import {
  delta,
  formatCount,
  formatMoneyCompact,
  formatMultiple,
  formatPercent,
} from '@/lib/format';
import {
  conversionRate,
  costPerBookingCents,
  getDashboardMetrics,
  roas,
  showRate,
  type GoalProgress,
} from '@/lib/metrics';
import { resolveRange } from '@/lib/range';
import { currentCaller } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { getMonthlyTrend } from '@/lib/trend';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Dashboard' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** One step of the b2c funnel, sized against the widest step. */
function FunnelStep({
  label,
  value,
  of,
  hint,
}: {
  label: string;
  value: number;
  of: number;
  hint: string;
}) {
  const width = of === 0 ? 0 : Math.round((value / of) * 100);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-fg">{label}</span>
        <span className="numeric text-sm text-fg-muted">
          {formatCount(value)}
          <span className="ml-2 text-fg-subtle">{hint}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Progress toward the client target. Shown as a bar rather than a second big
 * number so it reads as context for the hero, not competition with it.
 */
function GoalBar({ goal }: { goal: GoalProgress }) {
  const pct = goal.target === 0 ? 0 : Math.min(100, (goal.current / goal.target) * 100);
  const client = tenant.vocabulary.client;
  const deadline = new Date(`${goal.deadline}T00:00:00.000Z`);

  return (
    <div className="panel rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">
          Road to {formatCount(goal.target)} {client.plural}
        </h2>
        <span className="numeric text-xs text-fg-subtle">
          {goal.monthsRemaining < 0.05
            ? 'deadline passed'
            : `${goal.monthsRemaining.toFixed(1)} months left`}
          {' · '}
          {deadline.toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'long',
          })}
        </span>
      </div>

      <div className="mt-4 h-3 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3 text-xs">
        <span className="numeric text-fg-muted">
          {formatCount(goal.current)} of {formatCount(goal.target)} ·{' '}
          {formatPercent(goal.current / goal.target, 0)}
        </span>
        <span className="numeric text-fg-muted">
          {goal.current >= goal.target
            ? 'target met'
            : `${goal.requiredPerMonth.toFixed(1)} per month needed · ` +
              `${formatCount(goal.signedInRange)} signed this period`}
        </span>
      </div>
    </div>
  );
}

export default async function DashboardPage({ searchParams }: PageProps) {
  /*
   * Two views of the book: the rollup, and the tracker's own per-campaign
   * table. Tabs rather than a second page, because they answer the same
   * question at different grains and Josh reads the second one in a
   * spreadsheet today.
   *
   * FilterPillLinks is the app's existing link-driven segmented control, so the
   * selection lives in the URL and the page keeps rendering on the server.
   */
  const tab = single(searchParams['tab']) === 'tracker' ? 'tracker' : 'overview';

  const tabHref = (next: string): string => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      const flat = Array.isArray(value) ? value[0] : value;
      if (flat) params.set(key, flat);
    }
    if (next === 'tracker') params.set('tab', 'tracker');
    else params.delete('tab');
    const query = params.toString();
    return query ? `/dashboard?${query}` : '/dashboard';
  };

  const tabs = (
    <div className="mb-4">
      <FilterPillLinks
        options={[
          { key: 'overview', label: 'Overview', href: tabHref('overview') },
          {
            key: 'tracker',
            label: 'Client Fulfilment Tracker',
            href: tabHref('tracker'),
          },
        ]}
        value={tab}
      />
    </div>
  );

  if (tab === 'tracker') {
    /*
     * Returned before the dashboard's own queries run. They compute rollups for
     * every client, an eight-month trend and the goal progress, none of which
     * appears on this tab — doing that work anyway would make the tracker
     * slower than the spreadsheet it replaces.
     */
    return (
      <>
        <PageHeader
          eyebrow="Dashboard"
          title="Client Fulfilment Tracker"
          description="The STATS DASHBOARD tab, column for column, from the Hub's own data."
        />
        {tabs}
        <TrackerTab searchParams={searchParams} basePath="/dashboard" />
      </>
    );
  }

  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();
  const [metrics, rollups, trend, caller, lastSync] = await Promise.all([
    getDashboardMetrics(range),
    getGroupRollups(range),
    getMonthlyTrend(8),
    currentCaller(),
    db
      .from('sync_runs')
      .select('name, status, started_at, error_count')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // First name only, and only if we have one — "Hello, jemie@…" reads worse
  // than no greeting at all.
  const profile = caller
    ? await db
        .from('user_profiles')
        .select('full_name')
        .eq('id', caller.id)
        .maybeSingle()
    : null;

  const firstName = profile?.data?.full_name?.trim().split(/\s+/)[0] ?? null;
  const thisMonth = new Date().toISOString().slice(0, 7);

  const { current, previous, hero, goal } = metrics;
  const booking = tenant.vocabulary.booking;
  const client = tenant.vocabulary.client;
  const patient = tenant.vocabulary.endUser;

  const attention = rollups
    .filter((rollup) => rollup.health.level === 'at_risk')
    .slice(0, 6);

  /*
   * Sparkline series, from the eight-month trend already fetched for the chart
   * below. Monthly rather than daily, so a tile's shape and the bar chart under
   * it are telling the same story at the same resolution — two different
   * granularities on one screen invites the reader to compare them and be wrong.
   */
  const bookedTrend = trend.map((point) => point.booked);
  const showedTrend = trend.map((point) => point.showed);
  const wonTrend = trend.map((point) => point.won);
  const spendTrend = trend.map((point) => point.spendCents);

  return (
    <>
      <PageHeader
        eyebrow={firstName ? `Hello, ${firstName}` : 'Dashboard'}
        pill={{
          label: `${formatCount(current.activeClients)} active ${client.plural}`,
          tone: 'positive',
        }}
        title="How the book looks"
        description={
          <>
            {range.label}, against the preceding period ·{' '}
            <span className="text-accent">{formatCount(current.booked)}</span>{' '}
            {booking.plural} from ads, {formatCount(current.showed)} showed up
          </>
        }
        actions={<DateRangePicker />}
      />

      {tabs}

      {metrics.isEmpty ? (
        <EmptyState
          title="No data has landed yet"
          description={
            'The database is empty. Connect GoHighLevel in settings and run ' +
            `the CRM sync to pull ${client.plural} and ${booking.plural} in — ` +
            'this page then fills itself.'
          }
          icon={<AlertTriangle size={22} />}
        />
      ) : null}

      {/* The hero tile spans two columns and two rows: the owner should never
          have to look for it. */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          hero
          label={hero.label}
          value={hero.value}
          delta={hero.delta}
          higherIsBetter={hero.higherIsBetter}
          hint={hero.hint}
          icon={<Target size={18} />}
        />

        <KPICard
          label={`${titleCase(booking.plural)} from ads`}
          value={formatCount(current.booked)}
          delta={delta(current.booked, previous.booked)}
          hint={`${formatCount(current.awaitingOutcome)} awaiting an outcome · ${formatCount(current.liveBooked)} appointments of every kind`}
          icon={<CalendarCheck size={16} />}
          series={bookedTrend}
        />
        <KPICard
          label="Showed up"
          value={formatPercent(showRate(current), 0)}
          delta={
            showRate(current) !== null && showRate(previous) !== null
              ? (showRate(current) ?? 0) - (showRate(previous) ?? 0)
              : null
          }
          hint={`${formatCount(current.showed)} of ${formatCount(current.booked)}`}
          icon={<UserCheck size={16} />}
          series={showedTrend}
          seriesTone="positive"
        />
        <KPICard
          label="Closed"
          value={formatPercent(conversionRate(current), 0)}
          delta={
            conversionRate(current) !== null && conversionRate(previous) !== null
              ? (conversionRate(current) ?? 0) - (conversionRate(previous) ?? 0)
              : null
          }
          hint={`${formatCount(current.converted)} of those who showed`}
          icon={<CircleDollarSign size={16} />}
          series={wonTrend}
          seriesTone="positive"
        />
        <KPICard
          label="Leads"
          value={formatCount(current.leads)}
          delta={delta(current.leads, previous.leads)}
          hint="recorded against a campaign"
          icon={<MousePointerClick size={16} />}
        />
        <KPICard
          label="Ad spend"
          // Nought spend is not a spend of nought. No ad platform is connected,
          // so showing $0 would state as fact the one thing we do not know.
          value={
            current.spendCents === 0 ? '—' : formatMoneyCompact(current.spendCents)
          }
          delta={
            current.spendCents === 0
              ? null
              : delta(current.spendCents, previous.spendCents)
          }
          // More spend is not itself good news; it is only good next to revenue.
          higherIsBetter={false}
          // Only when there is spend: a flat line at nought looks like a
          // measurement rather than the absence of one.
          series={current.spendCents === 0 ? undefined : spendTrend}
          hint={
            current.spendCents === 0
              ? 'no ad account connected'
              : `${formatCount(current.clicks)} clicks`
          }
        />
        <KPICard
          label={`Cost per ${booking.singular}`}
          value={formatMoneyCompact(costPerBookingCents(current))}
          delta={
            costPerBookingCents(current) !== null &&
            costPerBookingCents(previous) !== null
              ? delta(
                  costPerBookingCents(current) ?? 0,
                  costPerBookingCents(previous) ?? 0,
                )
              : null
          }
          higherIsBetter={false}
        />
        <KPICard
          label="Return on ad spend"
          value={formatMultiple(roas(current))}
          delta={
            roas(current) !== null && roas(previous) !== null
              ? delta(roas(current) ?? 0, roas(previous) ?? 0)
              : null
          }
          hint={
            current.revenueCents === 0
              ? 'needs spend and case values'
              : `${formatMoneyCompact(current.revenueCents)} attributed`
          }
        />
      </section>

      <p className="mt-3 text-xs text-fg-subtle">
        The funnel above comes from the Client Fulfilment Tracker, which records
        the ad-sourced consultations Apex is paid on — 91% of its rows carry a
        campaign id. GoHighLevel holds{' '}
        {formatCount(current.liveBooked)} appointments of every kind for this
        period, hygiene and recalls included, and an outcome on none of them, so
        it cannot supply a funnel. The two are shown side by side rather than
        added: they overlap in time, and summing them would count the same
        consultation twice.
      </p>

      <div className="mt-6">
        <GoalBar goal={goal} />
      </div>

      <section className="mt-6 panel rounded-lg border border-line bg-surface p-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              {titleCase(booking.plural)} by month
            </h2>
            <p className="mt-0.5 text-xs text-fg-subtle">
              Last 8 months across every {client.singular} · attendance nested
              inside each bar
            </p>
          </div>
        </div>

        <BarChart
          outerLabel="booked"
          innerLabel="showed"
          bars={trend.map((point) => ({
            label: point.label,
            value: point.booked,
            inner: point.showed,
            partial: point.month === thisMonth,
          }))}
        />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-lg border border-line bg-surface p-6 lg:col-span-2">
          <h2 className="text-sm font-semibold text-fg">
            {tenant.funnels.b2c} funnel
          </h2>
          <p className="mb-5 mt-0.5 text-xs text-fg-subtle">
            Where {patient.plural} drop out, {range.label.toLowerCase()}
          </p>

          <div className="flex flex-col gap-4">
            <FunnelStep
              label={`${titleCase(booking.plural)} booked`}
              value={current.booked}
              of={current.booked}
              hint=""
            />
            <FunnelStep
              label="Showed up"
              value={current.showed}
              of={current.booked}
              hint={formatPercent(showRate(current), 0)}
            />
            <FunnelStep
              label="Converted"
              value={current.converted}
              of={current.booked}
              hint={formatPercent(
                current.booked === 0 ? null : current.converted / current.booked,
                0,
              )}
            />
          </div>
        </section>

        <section className="rounded-lg border border-line bg-surface p-6">
          <h2 className="text-sm font-semibold text-fg">Needs attention</h2>
          <p className="mb-4 mt-0.5 text-xs text-fg-subtle">
            {titleCase(client.plural)} to ring today
          </p>

          {attention.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Nothing flagged. Every active {client.singular} is booking.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {attention.map((rollup) => (
                <li key={rollup.group.id}>
                  <Link
                    href={`/clients/${rollup.group.id}`}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">
                        {rollup.group.name}
                      </span>
                      <span className="block truncate text-xs text-fg-subtle">
                        {rollup.health.reason}
                      </span>
                    </span>
                    <StatusPill
                      value="at risk"
                      tone={HEALTH_TONE[rollup.health.level]}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {lastSync.data ? (
        <p className="numeric mt-6 text-xs text-fg-subtle">
          Last sync: {lastSync.data.name} · {lastSync.data.status}
          {lastSync.data.error_count > 0
            ? ` · ${formatCount(lastSync.data.error_count)} errors`
            : ''}{' '}
          · {lastSync.data.started_at.slice(0, 16).replace('T', ' ')} UTC
        </p>
      ) : (
        <p className="mt-6 text-xs text-fg-subtle">No sync has run yet.</p>
      )}
    </>
  );
}
