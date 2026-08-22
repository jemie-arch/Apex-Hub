import { AdsWorkbench, type AdsClientRow } from '@/components/ads/AdsWorkbench';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { dateBounds, resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ads Management' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Every date in the range, so a quiet day is a trough rather than a gap. */
function dayKeys(from: string, to: string): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const last = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= last && keys.length < 400) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

/**
 * Ads management, by client.
 *
 * Keyed on the practice rather than the campaign, because the question anyone
 * here actually asks is "which client's ads are working" — a campaign name is
 * only how Meta happens to file it, and one practice runs several.
 *
 * Every column is something the data can answer. There is no clicks column and
 * no revenue column: the tracker records spend and leads per ad per day but not
 * impressions or clicks, and no case value is recorded anywhere. Cost per
 * booking stands in for return on ad spend, and is honest — it needs only spend
 * and bookings, both of which exist.
 */
export default async function AdsPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']) ?? 'last_30',
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();
  const { start, end } = dateBounds(range.from, range.to);
  const previous = dateBounds(range.previous.from, range.previous.to);

  const [groups, locations, snapshots, prior, appointments, ads, insights] =
    await Promise.all([
      db.from('client_groups').select('id, name, status').order('name'),
      db.from('clients').select('id, name, group_id'),
      db
        .from('ad_snapshots')
        .select('client_id, snapshot_on, spend_cents, leads')
        .gte('snapshot_on', start)
        .lte('snapshot_on', end),
      db
        .from('ad_snapshots')
        .select('client_id, spend_cents')
        .gte('snapshot_on', previous.start)
        .lte('snapshot_on', previous.end),
      db
        .from('tracker_appointments')
        .select('client_id, appointment_status, status_if_showed, booked_for')
        .gte('booked_for', start)
        .lte('booked_for', end)
        .limit(5000),
      db.from('ads').select('id, client_id, name'),
      db
        .from('ad_level_insights')
        .select('ad_id, spend_cents, leads')
        .gte('insight_on', start)
        .lte('insight_on', end)
        .limit(20000),
    ]);

  for (const result of [groups, locations, snapshots, prior, appointments, ads, insights]) {
    if (result.error) throw result.error;
  }

  // location -> business, so per-location spend rolls up to the practice.
  const groupOf = new Map<string, string>();
  for (const row of locations.data ?? []) {
    if (row.group_id) groupOf.set(row.id, row.group_id);
  }

  const days = dayKeys(start, end);
  const dayIndex = new Map(days.map((day, index) => [day, index]));

  const rows = new Map<string, AdsClientRow>();
  for (const group of groups.data ?? []) {
    rows.set(group.id, {
      id: group.id,
      name: group.name,
      status: group.status,
      spendCents: 0,
      previousSpendCents: 0,
      leads: 0,
      booked: 0,
      showed: 0,
      noShow: 0,
      closed: 0,
      dailySpend: new Array<number>(days.length).fill(0),
      topAds: [],
    });
  }

  for (const snapshot of snapshots.data ?? []) {
    const groupId = groupOf.get(snapshot.client_id);
    const row = groupId ? rows.get(groupId) : undefined;
    if (!row) continue;

    row.spendCents += snapshot.spend_cents;
    row.leads += snapshot.leads;

    const index = dayIndex.get(snapshot.snapshot_on);
    if (index !== undefined) {
      row.dailySpend[index] = (row.dailySpend[index] ?? 0) + snapshot.spend_cents;
    }
  }

  for (const snapshot of prior.data ?? []) {
    const groupId = groupOf.get(snapshot.client_id);
    const row = groupId ? rows.get(groupId) : undefined;
    if (row) row.previousSpendCents += snapshot.spend_cents;
  }

  for (const appointment of appointments.data ?? []) {
    if (!appointment.client_id) continue;
    const groupId = groupOf.get(appointment.client_id);
    const row = groupId ? rows.get(groupId) : undefined;
    if (!row) continue;

    row.booked += 1;
    if (appointment.appointment_status === 'Showed') row.showed += 1;
    else if (appointment.appointment_status === 'No Show') row.noShow += 1;
    if (appointment.status_if_showed === 'Closed') row.closed += 1;
  }

  // Per-ad spend, kept only for the inspected client's top-ads list.
  const adSpend = new Map<string, { spendCents: number; leads: number }>();
  for (const insight of insights.data ?? []) {
    const entry = adSpend.get(insight.ad_id) ?? { spendCents: 0, leads: 0 };
    entry.spendCents += insight.spend_cents;
    entry.leads += insight.leads;
    adSpend.set(insight.ad_id, entry);
  }

  for (const ad of ads.data ?? []) {
    const spend = adSpend.get(ad.id);
    if (!spend || spend.spendCents === 0) continue;

    const groupId = groupOf.get(ad.client_id);
    const row = groupId ? rows.get(groupId) : undefined;
    if (!row) continue;

    row.topAds.push({
      id: ad.id,
      name: ad.name,
      spendCents: spend.spendCents,
      leads: spend.leads,
    });
  }

  for (const row of rows.values()) {
    row.topAds.sort((a, b) => b.spendCents - a.spendCents);
    row.topAds = row.topAds.slice(0, 6);
  }

  // Only practices with something to show in this period. A list of forty rows
  // of zeroes is not a report, it is a client list.
  const table = [...rows.values()]
    .filter((row) => row.spendCents > 0 || row.booked > 0)
    .sort((a, b) => b.spendCents - a.spendCents);

  return (
    <AdsWorkbench
      rows={table}
      days={days}
      rangeLabel={range.label}
      controls={<DateRangePicker />}
    />
  );
}
