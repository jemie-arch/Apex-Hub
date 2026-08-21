/**
 * Every number on /dashboard comes from here, including the hero metric, so
 * two pages can never disagree about what "converted" means.
 *
 * Definitions, fixed in one place:
 *   booked      a b2c appointment whose scheduled time falls in the range
 *   showed      of those, showed IS TRUE. NULL is unknown, not a no-show.
 *   converted   of those, outcome = 'won'
 *   revenue     sum of value_cents on won appointments in the range
 *   spend       ad spend from the daily per-location rollup
 *   clients     ACTIVE BUSINESSES, not sub-accounts. A practice running three
 *               sub-accounts is one client, which is how the company counts.
 */
import { tenant, type HeroMetricKey } from '@/config/tenant.config';
import {
  delta,
  formatCount,
  formatMoneyCompact,
  formatMultiple,
  formatPercent,
} from '@/lib/format';
import { bounds, dateBounds, type DateRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export interface PeriodTotals {
  booked: number;
  showed: number;
  /** Appointments still 'pending' — the follow-up backlog. */
  awaitingOutcome: number;
  converted: number;
  revenueCents: number;
  spendCents: number;
  leads: number;
  clicks: number;
  impressions: number;
  /** Active businesses right now. Not sub-accounts. */
  activeClients: number;
  /** Businesses whose signed_on falls inside the range. */
  signedInRange: number;
}

export interface GoalProgress {
  target: number;
  deadline: string;
  current: number;
  signedInRange: number;
  monthsRemaining: number;
  /** How many per month from here to land on target by the deadline. */
  requiredPerMonth: number;
}

export interface HeroMetric {
  key: HeroMetricKey;
  label: string;
  value: string;
  delta: number | null;
  higherIsBetter: boolean;
  hint: string;
}

export interface DashboardMetrics {
  range: DateRange;
  current: PeriodTotals;
  previous: PeriodTotals;
  hero: HeroMetric;
  goal: GoalProgress;
  /** True when nothing has been synced yet. */
  isEmpty: boolean;
}

const EMPTY: PeriodTotals = {
  booked: 0,
  showed: 0,
  awaitingOutcome: 0,
  converted: 0,
  revenueCents: 0,
  spendCents: 0,
  leads: 0,
  clicks: 0,
  impressions: 0,
  activeClients: 0,
  signedInRange: 0,
};

export function showRate(totals: PeriodTotals): number | null {
  return totals.booked === 0 ? null : totals.showed / totals.booked;
}

export function conversionRate(totals: PeriodTotals): number | null {
  return totals.showed === 0 ? null : totals.converted / totals.showed;
}

export function costPerBookingCents(totals: PeriodTotals): number | null {
  return totals.booked === 0
    ? null
    : Math.round(totals.spendCents / totals.booked);
}

export function roas(totals: PeriodTotals): number | null {
  return totals.spendCents === 0 ? null : totals.revenueCents / totals.spendCents;
}

/**
 * One period's aggregates.
 *
 * `groupId` scopes to a single business — which means every one of its
 * sub-accounts, resolved first so the appointment and spend queries can filter
 * on location ids.
 */
async function collectPeriod(
  from: Date,
  to: Date,
  groupId?: string,
): Promise<PeriodTotals> {
  const db = serviceClient();
  const { start, end } = bounds(from, to);
  const { start: dateStart, end: dateEnd } = dateBounds(from, to);

  let locationIds: string[] | null = null;
  if (groupId) {
    const locations = await db
      .from('clients')
      .select('id')
      .eq('group_id', groupId);
    if (locations.error) throw locations.error;

    locationIds = (locations.data ?? []).map((row) => row.id);
    // A business with no sub-accounts yet has no bookings and no spend. Return
    // early rather than issuing an `in ()` that would match everything.
    if (locationIds.length === 0) return { ...EMPTY, activeClients: 1 };
  }

  let appointmentQuery = db
    .from('appointments')
    .select('showed, outcome, value_cents')
    .gte('scheduled_at', start)
    .lte('scheduled_at', end);
  if (locationIds) appointmentQuery = appointmentQuery.in('client_id', locationIds);

  let snapshotQuery = db
    .from('ad_snapshots')
    .select('spend_cents, leads, clicks, impressions')
    .gte('snapshot_on', dateStart)
    .lte('snapshot_on', dateEnd);
  if (locationIds) snapshotQuery = snapshotQuery.in('client_id', locationIds);

  const activeQuery = db
    .from('client_groups')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

  const signedQuery = db
    .from('client_groups')
    .select('id', { count: 'exact', head: true })
    .gte('signed_on', dateStart)
    .lte('signed_on', dateEnd);

  const [appointments, snapshots, active, signed] = await Promise.all([
    appointmentQuery,
    snapshotQuery,
    activeQuery,
    signedQuery,
  ]);

  if (appointments.error) throw appointments.error;
  if (snapshots.error) throw snapshots.error;
  if (active.error) throw active.error;
  if (signed.error) throw signed.error;

  const totals: PeriodTotals = { ...EMPTY };

  for (const row of appointments.data ?? []) {
    totals.booked += 1;
    if (row.showed === true) totals.showed += 1;
    if (row.outcome === 'pending') totals.awaitingOutcome += 1;
    if (row.outcome === 'won') {
      totals.converted += 1;
      totals.revenueCents += row.value_cents ?? 0;
    }
  }

  for (const row of snapshots.data ?? []) {
    totals.spendCents += row.spend_cents;
    totals.leads += row.leads;
    totals.clicks += row.clicks;
    totals.impressions += row.impressions;
  }

  totals.activeClients = groupId ? 1 : (active.count ?? 0);
  totals.signedInRange = signed.count ?? 0;

  return totals;
}

const HERO_METRIC_KEYS: readonly HeroMetricKey[] = [
  'clients_toward_goal',
  'revenue_this_month',
  'bookings_this_month',
  'booked_to_shown_rate',
  'cost_per_booking',
  'return_on_ad_spend',
  'active_clients',
];

async function resolveHeroMetricKey(): Promise<HeroMetricKey> {
  const { data } = await serviceClient()
    .from('app_settings')
    .select('value')
    .eq('key', 'hero_metric')
    .maybeSingle();

  const raw = typeof data?.value === 'string' ? data.value : null;
  return raw && HERO_METRIC_KEYS.includes(raw as HeroMetricKey)
    ? (raw as HeroMetricKey)
    : tenant.heroMetric;
}

/** Growth target from app_settings, with a sane fallback if it is missing. */
async function resolveGoal(
  current: number,
  signedInRange: number,
  now: Date,
): Promise<GoalProgress> {
  const { data } = await serviceClient()
    .from('app_settings')
    .select('value')
    .eq('key', 'client_goal')
    .maybeSingle();

  const raw =
    data && typeof data.value === 'object' && data.value !== null
      ? (data.value as Record<string, unknown>)
      : {};

  const target = typeof raw['target'] === 'number' ? raw['target'] : 100;
  const deadline =
    typeof raw['deadline'] === 'string' ? raw['deadline'] : '2026-12-01';

  const deadlineDate = new Date(`${deadline}T00:00:00.000Z`);
  const msRemaining = deadlineDate.getTime() - now.getTime();
  // Partial months count: with 18 days left the answer is not "0 months".
  const monthsRemaining = Math.max(0, msRemaining / (30.44 * 86_400_000));

  const shortfall = Math.max(0, target - current);
  const requiredPerMonth =
    monthsRemaining <= 0 ? shortfall : shortfall / monthsRemaining;

  return {
    target,
    deadline,
    current,
    signedInRange,
    monthsRemaining,
    requiredPerMonth,
  };
}

function buildHero(
  key: HeroMetricKey,
  current: PeriodTotals,
  previous: PeriodTotals,
  goal: GoalProgress,
): HeroMetric {
  const booking = tenant.vocabulary.booking;
  const client = tenant.vocabulary.client;

  switch (key) {
    case 'clients_toward_goal': {
      const hint =
        goal.current >= goal.target
          ? `target met — ${formatCount(goal.signedInRange)} signed this period`
          : `${goal.requiredPerMonth.toFixed(1)}/month needed by ` +
            `${new Date(`${goal.deadline}T00:00:00.000Z`).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
            })}`;

      return {
        key,
        label: `Active ${client.plural} toward ${formatCount(goal.target)}`,
        value: `${formatCount(goal.current)} / ${formatCount(goal.target)}`,
        // Against the previous period's active count, so the arrow reflects
        // net growth rather than gross signings.
        delta: delta(current.activeClients, previous.activeClients),
        higherIsBetter: true,
        hint,
      };
    }

    case 'bookings_this_month':
      return {
        key,
        label: `${booking.plural} booked`,
        value: formatCount(current.booked),
        delta: delta(current.booked, previous.booked),
        higherIsBetter: true,
        hint: `${formatCount(current.showed)} showed`,
      };

    case 'booked_to_shown_rate': {
      const rate = showRate(current);
      const prior = showRate(previous);
      return {
        key,
        label: 'Booked to shown',
        value: formatPercent(rate, 1),
        delta: rate !== null && prior !== null ? rate - prior : null,
        higherIsBetter: true,
        hint: `${formatCount(current.showed)} of ${formatCount(current.booked)}`,
      };
    }

    case 'cost_per_booking': {
      const cost = costPerBookingCents(current);
      const prior = costPerBookingCents(previous);
      return {
        key,
        label: `Cost per ${booking.singular}`,
        value: formatMoneyCompact(cost),
        delta: cost !== null && prior !== null ? delta(cost, prior) : null,
        // Paying more for the same appointment is worse, not better.
        higherIsBetter: false,
        hint: `${formatMoneyCompact(current.spendCents)} spend`,
      };
    }

    case 'return_on_ad_spend': {
      const value = roas(current);
      const prior = roas(previous);
      return {
        key,
        label: 'Return on ad spend',
        value: formatMultiple(value),
        delta: value !== null && prior !== null ? delta(value, prior) : null,
        higherIsBetter: true,
        hint:
          `${formatMoneyCompact(current.revenueCents)} on ` +
          `${formatMoneyCompact(current.spendCents)}`,
      };
    }

    case 'active_clients':
      return {
        key,
        label: `Active ${client.plural}`,
        value: formatCount(current.activeClients),
        delta: delta(current.activeClients, previous.activeClients),
        higherIsBetter: true,
        hint: 'right now',
      };

    case 'revenue_this_month':
    default:
      return {
        key: 'revenue_this_month',
        label: 'Revenue',
        value: formatMoneyCompact(current.revenueCents),
        delta: delta(current.revenueCents, previous.revenueCents),
        higherIsBetter: true,
        hint: `${formatCount(current.converted)} won`,
      };
  }
}

export async function getDashboardMetrics(
  range: DateRange,
  groupId?: string,
): Promise<DashboardMetrics> {
  const [current, previous, heroKey] = await Promise.all([
    collectPeriod(range.from, range.to, groupId),
    collectPeriod(range.previous.from, range.previous.to, groupId),
    resolveHeroMetricKey(),
  ]);

  const goal = await resolveGoal(
    current.activeClients,
    current.signedInRange,
    new Date(),
  );

  return {
    range,
    current,
    previous,
    goal,
    hero: buildHero(heroKey, current, previous, goal),
    isEmpty:
      current.booked === 0 &&
      previous.booked === 0 &&
      current.spendCents === 0 &&
      current.activeClients === 0,
  };
}
