/**
 * Monthly history for the dashboard trend.
 *
 * Two queries and a group-by in memory rather than a SQL date_trunc per
 * metric: the window is small and bounded, and keeping the bucketing here
 * means the month boundaries match the rest of the app exactly.
 */
import { serviceClient } from '@/lib/supabase/service';

export interface MonthPoint {
  /** YYYY-MM */
  month: string;
  /** Short label for the axis, e.g. "Aug". */
  label: string;
  booked: number;
  showed: number;
  won: number;
  spendCents: number;
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** First day of the month, `offset` months before now, in UTC. */
function monthStart(offset: number, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
}

export async function getMonthlyTrend(
  months = 8,
  now: Date = new Date(),
): Promise<MonthPoint[]> {
  const db = serviceClient();
  const from = monthStart(months - 1, now);

  // Same source as the cards above it, deliberately. Read from the synced
  // appointments table this chart drew a "won" line that was zero in every
  // month — not because nothing closed, but because that table has an outcome on
  // none of its rows. A chart disagreeing with the number beside it is worse
  // than either being wrong alone.
  const [appointments, snapshots] = await Promise.all([
    db
      .from('tracker_appointments')
      .select('booked_for, appointment_status, status_if_showed')
      .gte('booked_for', from.toISOString().slice(0, 10)),
    db
      .from('ad_snapshots')
      .select('snapshot_on, spend_cents')
      .gte('snapshot_on', from.toISOString().slice(0, 10)),
  ]);

  if (appointments.error) throw appointments.error;
  if (snapshots.error) throw snapshots.error;

  // Seeded with every month in the window, so a quiet month renders as a zero
  // bar rather than vanishing and making the axis lie about the time span.
  const points = new Map<string, MonthPoint>();
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const start = monthStart(offset, now);
    points.set(monthKey(start), {
      month: monthKey(start),
      label: start.toLocaleDateString('en-GB', {
        month: 'short',
        timeZone: 'UTC',
      }),
      booked: 0,
      showed: 0,
      won: 0,
      spendCents: 0,
    });
  }

  for (const row of appointments.data ?? []) {
    if (row.booked_for === null) continue;
    const point = points.get(row.booked_for.slice(0, 7));
    if (!point) continue;

    point.booked += 1;
    if (row.appointment_status === 'Showed') point.showed += 1;
    if (row.status_if_showed === 'Closed') point.won += 1;
  }

  for (const row of snapshots.data ?? []) {
    const point = points.get(row.snapshot_on.slice(0, 7));
    if (!point) continue;
    point.spendCents += row.spend_cents;
  }

  return [...points.values()];
}
