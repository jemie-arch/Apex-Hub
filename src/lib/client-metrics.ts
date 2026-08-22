/**
 * Per-business rollups for /clients and /compare.
 *
 * A business can run several CRM sub-accounts, so every figure here is summed
 * across its locations. Four queries and a group-by in memory rather than one
 * query per business: this is the page most likely to grow an N+1, and at 100
 * clients that would be 100 round trips.
 */
import type { ClientGroupRow, ClientRow } from '@/types/database';

import { dateBounds, type DateRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export interface ClientHealth {
  level: 'good' | 'watch' | 'at_risk' | 'idle';
  /** Why it is that level. A colour with no reason is not an indicator. */
  reason: string;
}

export interface GroupRollup {
  group: ClientGroupRow;
  /** The CRM sub-accounts this business runs. Often one. */
  locations: ClientRow[];
  booked: number;
  showed: number;
  converted: number;
  awaitingOutcome: number;
  revenueCents: number;
  spendCents: number;
  clicks: number;
  showRate: number | null;
  conversionRate: number | null;
  costPerBookingCents: number | null;
  roas: number | null;
  health: ClientHealth;
}

/**
 * Rule-based and explainable rather than a score. The owner needs to know
 * which practice to ring, and why.
 */
export function clientHealth(
  group: ClientGroupRow,
  totals: {
    booked: number;
    showed: number;
    spendCents: number;
    awaitingOutcome: number;
    locationCount: number;
  },
): ClientHealth {
  if (group.status === 'churned') return { level: 'idle', reason: 'Churned' };
  if (group.status === 'paused') return { level: 'idle', reason: 'Paused' };

  // A business still marked 'onboarding' that is taking consultations is not
  // onboarding, whatever the column says — the status is set once at creation
  // and never advanced, so it reads 'onboarding' for almost every client. Where
  // there are bookings, judge on the bookings; only believe the label when
  // there is nothing else to go on.
  if (group.status === 'onboarding' && totals.booked === 0) {
    return { level: 'idle', reason: `Onboarding — ${group.onboarding_stage}` };
  }

  // An active business with no sub-account cannot book anything: the setup is
  // unfinished, which is a different problem from underperforming.
  if (totals.locationCount === 0) {
    return { level: 'at_risk', reason: 'Active with no CRM sub-account linked' };
  }

  // Money going out with nothing coming back is the loudest signal there is.
  if (totals.spendCents > 0 && totals.booked === 0) {
    return { level: 'at_risk', reason: 'Spending with no appointments' };
  }
  if (totals.booked === 0) {
    return { level: 'at_risk', reason: 'No appointments this period' };
  }

  const rate = totals.showed / totals.booked;
  if (rate < 0.5) {
    return { level: 'watch', reason: 'Under half of appointments show up' };
  }

  // A pile of unresolved outcomes means the numbers below are not trustworthy.
  if (totals.awaitingOutcome > totals.booked * 0.4) {
    return { level: 'watch', reason: 'Outcomes not being recorded' };
  }

  return { level: 'good', reason: 'On track' };
}

export const HEALTH_TONE = {
  good: 'positive',
  watch: 'warning',
  at_risk: 'negative',
  idle: 'neutral',
} as const;

export async function getGroupRollups(
  range: DateRange,
): Promise<GroupRollup[]> {
  const db = serviceClient();
  const { start: dateStart, end: dateEnd } = dateBounds(range.from, range.to);

  const [groups, locations, appointments, snapshots] = await Promise.all([
    // Practices only. The agency's own sub-accounts — the sales pipeline, the
    // onboarding account, the snapshot holders — are real locations that would
    // otherwise be scored for health alongside clients and rate nothing.
    db.from('client_groups').select('*').eq('is_internal', false).order('name'),
    db.from('clients').select('*').order('name'),
    // The tracker, not the synced appointments table, for the same reason the
    // dashboard uses it: this one records whether the consultation happened and
    // whether it closed. Health is judged on outcomes, and every synced row's
    // outcome still reads 'pending', which would rate every client identically.
    db
      .from('tracker_appointments')
      .select('client_id, appointment_status, status_if_showed')
      .gte('booked_for', dateStart)
      .lte('booked_for', dateEnd),
    db
      .from('ad_snapshots')
      .select('client_id, spend_cents, clicks')
      .gte('snapshot_on', dateStart)
      .lte('snapshot_on', dateEnd),
  ]);

  if (groups.error) throw groups.error;
  if (locations.error) throw locations.error;
  if (appointments.error) throw appointments.error;
  if (snapshots.error) throw snapshots.error;

  // location id -> business id, so per-location rows can be attributed.
  const groupIdByLocation = new Map<string, string>();
  const locationsByGroup = new Map<string, ClientRow[]>();
  for (const location of locations.data ?? []) {
    groupIdByLocation.set(location.id, location.group_id);
    const list = locationsByGroup.get(location.group_id) ?? [];
    list.push(location);
    locationsByGroup.set(location.group_id, list);
  }

  interface Bucket {
    booked: number;
    showed: number;
    converted: number;
    awaitingOutcome: number;
    revenueCents: number;
    spendCents: number;
    clicks: number;
  }

  const buckets = new Map<string, Bucket>();
  const bucketFor = (groupId: string): Bucket => {
    const existing = buckets.get(groupId);
    if (existing) return existing;
    const fresh: Bucket = {
      booked: 0,
      showed: 0,
      converted: 0,
      awaitingOutcome: 0,
      revenueCents: 0,
      spendCents: 0,
      clicks: 0,
    };
    buckets.set(groupId, fresh);
    return fresh;
  };

  for (const row of appointments.data ?? []) {
    // A tracker row whose clinic name matched no practice is not attributed to a
    // guess; it is dropped from the rollup.
    if (row.client_id === null) continue;
    const groupId = groupIdByLocation.get(row.client_id);
    if (!groupId) continue;

    const bucket = bucketFor(groupId);
    bucket.booked += 1;

    const attended = row.appointment_status === 'Showed';
    if (attended) bucket.showed += 1;
    if (row.status_if_showed === 'Closed') bucket.converted += 1;
    else if (attended && row.status_if_showed === null) {
      bucket.awaitingOutcome += 1;
    }
    // No revenue: the sheet records that a case closed, never what it was worth.
  }

  for (const row of snapshots.data ?? []) {
    const groupId = groupIdByLocation.get(row.client_id);
    if (!groupId) continue;

    const bucket = bucketFor(groupId);
    bucket.spendCents += row.spend_cents;
    bucket.clicks += row.clicks;
  }

  return (groups.data ?? []).map((group) => {
    const bucket = bucketFor(group.id);
    const groupLocations = locationsByGroup.get(group.id) ?? [];

    return {
      group,
      locations: groupLocations,
      ...bucket,
      showRate: bucket.booked === 0 ? null : bucket.showed / bucket.booked,
      conversionRate:
        bucket.showed === 0 ? null : bucket.converted / bucket.showed,
      // Null, not nought: no spend recorded means unknown cost, not free.
      costPerBookingCents:
        bucket.booked === 0 || bucket.spendCents === 0
          ? null
          : Math.round(bucket.spendCents / bucket.booked),
      roas:
        bucket.spendCents === 0 ? null : bucket.revenueCents / bucket.spendCents,
      health: clientHealth(group, {
        ...bucket,
        locationCount: groupLocations.length,
      }),
    };
  });
}
