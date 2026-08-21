/**
 * The client portal — the reporting the practice actually sees.
 *
 * Unauthenticated by design: the token IS the credential. It is safe because
 * every query below is scoped by the business the token resolves to, so a
 * different token resolves to nothing rather than to a neighbour's records.
 *
 * What it deliberately does NOT show: retainer, internal health, other
 * clients, or anything about Apex's own funnel.
 */
import { CalendarCheck, CircleDollarSign, Megaphone, UserCheck } from 'lucide-react';
import { notFound } from 'next/navigation';

import { OutcomeRow, type PortalAppointment } from '@/components/portal/OutcomeRow';
import { KPICard } from '@/components/ui/KPICard';
import { tenant, titleCase } from '@/config/tenant.config';
import {
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
} from '@/lib/format';
import { bounds, dateBounds, resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// A portal link must never end up in a search index.
export const metadata = {
  title: 'Your results',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PortalPage({ params, searchParams }: PageProps) {
  const db = serviceClient();

  const groupResult = await db
    .from('client_groups')
    .select('id, name, currency, portal_enabled')
    .eq('portal_token', params.token)
    .maybeSingle();

  if (groupResult.error) throw groupResult.error;

  // A disabled portal is indistinguishable from a wrong token, on purpose.
  if (!groupResult.data || !groupResult.data.portal_enabled) notFound();

  const group = groupResult.data;

  const range = resolveRange({
    preset: single(searchParams['preset']) ?? 'last_30',
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });
  const { start, end } = bounds(range.from, range.to);
  const { start: dateStart, end: dateEnd } = dateBounds(range.from, range.to);

  const locationsResult = await db
    .from('clients')
    .select('id, name, timezone')
    .eq('group_id', group.id)
    .order('name');
  if (locationsResult.error) throw locationsResult.error;

  const locations = locationsResult.data ?? [];
  const locationIds = locations.map((row) => row.id);
  const locationById = new Map(locations.map((row) => [row.id, row]));

  const [appointments, snapshots] = await Promise.all([
    db
      .from('appointments')
      .select(
        'id, client_id, patient_name, scheduled_at, status, showed, outcome, value_cents',
      )
      .in('client_id', locationIds)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at', { ascending: false })
      .limit(300),
    db
      .from('ad_snapshots')
      .select('spend_cents')
      .in('client_id', locationIds)
      .gte('snapshot_on', dateStart)
      .lte('snapshot_on', dateEnd),
  ]);

  if (appointments.error) throw appointments.error;
  if (snapshots.error) throw snapshots.error;

  const rows = appointments.data ?? [];
  let showed = 0;
  let won = 0;
  let revenueCents = 0;
  let awaiting = 0;

  for (const row of rows) {
    if (row.showed === true) showed += 1;
    if (row.outcome === 'pending') awaiting += 1;
    if (row.outcome === 'won') {
      won += 1;
      revenueCents += row.value_cents ?? 0;
    }
  }

  const spendCents = (snapshots.data ?? []).reduce(
    (total, row) => total + row.spend_cents,
    0,
  );
  const costPerBooking =
    rows.length === 0 ? null : Math.round(spendCents / rows.length);

  const portalRows: PortalAppointment[] = rows.map((row) => {
    const owner = locationById.get(row.client_id);
    return {
      id: row.id,
      patientName: row.patient_name,
      scheduledAt: row.scheduled_at,
      status: row.status,
      showed: row.showed,
      outcome: row.outcome,
      valueCents: row.value_cents,
      locationName: owner?.name ?? 'Unknown',
      timezone: owner?.timezone ?? tenant.defaultTimezone,
    };
  });

  const booking = tenant.vocabulary.booking;
  const patient = tenant.vocabulary.endUser;
  const showLocation = locations.length > 1;

  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {tenant.company.name}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">
              {group.name}
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              {titleCase(patient.singular)} results · {range.label.toLowerCase()}
            </p>
          </div>
          <span
            className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-contrast"
            aria-hidden
          >
            {tenant.company.initial}
          </span>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard
            label={`${titleCase(booking.plural)} booked`}
            value={formatCount(rows.length)}
            hint={`${formatCount(awaiting)} still to confirm`}
            icon={<CalendarCheck size={16} />}
          />
          <KPICard
            label="Attended"
            value={formatPercent(
              rows.length === 0 ? null : showed / rows.length,
              0,
            )}
            hint={`${formatCount(showed)} of ${formatCount(rows.length)}`}
            icon={<UserCheck size={16} />}
          />
          <KPICard
            label="Started treatment"
            value={formatCount(won)}
            hint={`${formatMoneyCompact(revenueCents, group.currency)} in value`}
            icon={<CircleDollarSign size={16} />}
          />
          <KPICard
            label="Ad spend"
            value={formatMoneyCompact(spendCents, group.currency)}
            higherIsBetter={false}
            hint={
              costPerBooking === null
                ? 'no bookings yet'
                : `${formatMoney(costPerBooking, group.currency)} per ${booking.singular}`
            }
            icon={<Megaphone size={16} />}
          />
        </section>

        <section className="mt-8 overflow-hidden rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-fg">
              Your {booking.plural}
            </h2>
            <p className="mt-0.5 text-xs text-fg-subtle">
              Select a row to record whether they attended and what they went
              ahead with. What you enter here is never overwritten.
            </p>
          </div>

          {portalRows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-fg-muted">
              No {booking.plural} in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                    <th className="px-4 py-3 font-medium">When</th>
                    {showLocation ? (
                      <th className="px-4 py-3 font-medium">
                        {titleCase(tenant.vocabulary.location.singular)}
                      </th>
                    ) : null}
                    <th className="px-4 py-3 font-medium">
                      {titleCase(patient.singular)}
                    </th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Outcome</th>
                    <th className="px-4 py-3 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {portalRows.map((appointment) => (
                    <OutcomeRow
                      key={appointment.id}
                      appointment={appointment}
                      token={params.token}
                      currency={group.currency}
                      showLocation={showLocation}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-6 text-center text-xs text-fg-subtle">
          Figures update through the day. Times shown in each{' '}
          {tenant.vocabulary.location.singular}&apos;s local timezone.
        </p>
      </div>
    </main>
  );
}
