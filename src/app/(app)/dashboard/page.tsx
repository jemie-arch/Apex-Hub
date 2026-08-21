import {
  AlertTriangle,
  CalendarCheck,
  CircleDollarSign,
  MousePointerClick,
  Target,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
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
import { serviceClient } from '@/lib/supabase/service';

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
    <div className="rounded-lg border border-line bg-surface p-5 shadow-sm">
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
  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();
  const [metrics, rollups, lastSync] = await Promise.all([
    getDashboardMetrics(range),
    getGroupRollups(range),
    db
      .from('sync_runs')
      .select('name, status, started_at, error_count')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const { current, previous, hero, goal } = metrics;
  const booking = tenant.vocabulary.booking;
  const client = tenant.vocabulary.client;
  const patient = tenant.vocabulary.endUser;

  const attention = rollups
    .filter((rollup) => rollup.health.level === 'at_risk')
    .slice(0, 6);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${range.label} · versus the preceding period`}
        actions={<DateRangePicker />}
      />

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
          label={`${titleCase(booking.plural)} booked`}
          value={formatCount(current.booked)}
          delta={delta(current.booked, previous.booked)}
          hint={`${formatCount(current.awaitingOutcome)} awaiting an outcome`}
          icon={<CalendarCheck size={16} />}
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
        />
        <KPICard
          label="Converted"
          value={formatPercent(conversionRate(current), 0)}
          delta={
            conversionRate(current) !== null && conversionRate(previous) !== null
              ? (conversionRate(current) ?? 0) - (conversionRate(previous) ?? 0)
              : null
          }
          hint={`${formatCount(current.converted)} won`}
          icon={<CircleDollarSign size={16} />}
        />
        <KPICard
          label="Ad spend"
          value={formatMoneyCompact(current.spendCents)}
          delta={delta(current.spendCents, previous.spendCents)}
          // More spend is not itself good news; it is only good next to revenue.
          higherIsBetter={false}
          // Clicks, not leads: the ad platform reports no leads because the
          // forms live in the CRM. Booked is the real downstream number.
          hint={`${formatCount(current.clicks)} clicks`}
          icon={<MousePointerClick size={16} />}
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
          hint={`${formatMoneyCompact(current.revenueCents)} attributed`}
        />
      </section>

      <div className="mt-6">
        <GoalBar goal={goal} />
      </div>

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
