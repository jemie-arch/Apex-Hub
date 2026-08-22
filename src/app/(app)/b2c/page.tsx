import { BadgeDollarSign } from 'lucide-react';
import Link from 'next/link';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  StatusPill,
  appointmentStatusTone,
  outcomeTone,
} from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import {
  formatCount,
  formatDateTimeInZone,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  zoneAbbreviation,
} from '@/lib/format';
import { bounds, resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Consultations' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Every patient consultation across every client, in one list.
 *
 * The per-client view answers "how is this practice doing"; this one answers
 * "what happened today", which is a different question and needs its own page.
 */
export default async function ConsultationsPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']) ?? 'last_30',
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();
  const { start, end } = bounds(range.from, range.to);

  const [appointments, locations, groups] = await Promise.all([
    db
      .from('appointments')
      .select(
        'id, client_id, patient_name, scheduled_at, status, showed, outcome, value_cents, booked_by_name, attribution_source',
      )
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at', { ascending: false })
      .limit(400),
    db.from('clients').select('id, name, group_id, timezone'),
    db.from('client_groups').select('id, name, currency'),
  ]);

  if (appointments.error) throw appointments.error;
  if (locations.error) throw locations.error;
  if (groups.error) throw groups.error;

  const locationById = new Map(
    (locations.data ?? []).map((row) => [row.id, row]),
  );
  const groupById = new Map((groups.data ?? []).map((row) => [row.id, row]));

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

  const booking = tenant.vocabulary.booking;
  const patient = tenant.vocabulary.endUser;

  return (
    <>
      <PageHeader
        title="Consultations"
        description={`Every ${patient.singular} ${booking.singular} across all ${tenant.vocabulary.client.plural} · ${range.label}`}
        actions={<DateRangePicker />}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard label="Booked" value={formatCount(rows.length)} hint={`${formatCount(awaiting)} awaiting an outcome`} />
        <KPICard
          label="Attended"
          value={formatPercent(rows.length === 0 ? null : showed / rows.length, 0)}
          hint={`${formatCount(showed)} of ${formatCount(rows.length)}`}
        />
        <KPICard label="Started treatment" value={formatCount(won)} />
        <KPICard label="Treatment value" value={formatMoneyCompact(revenueCents)} />
      </section>

      {rows.length === 0 ? (
        <EmptyState
          title={`No ${booking.plural} in this period`}
          description="Widen the date range, or run the CRM sync if nothing has come in yet."
          icon={<BadgeDollarSign size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">{titleCase(patient.singular)}</th>
                  <th className="px-4 py-3 font-medium">{titleCase(tenant.vocabulary.client.singular)}</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                  <th className="px-4 py-3 font-medium">Booked by</th>
                  <th className="px-4 py-3 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const location = locationById.get(row.client_id);
                  const group = location ? groupById.get(location.group_id) : null;
                  const zone = location?.timezone ?? tenant.defaultTimezone;

                  return (
                    <tr
                      key={row.id}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="numeric px-4 py-3 text-fg-muted">
                        {formatDateTimeInZone(row.scheduled_at, zone, 'd MMM, HH:mm')}
                        <span className="ml-1.5 text-xs text-fg-subtle">
                          {zoneAbbreviation(zone)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-fg">
                        {row.patient_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {group ? (
                          <Link
                            href={`/clients/${group.id}`}
                            className="hover:text-accent"
                          >
                            {group.name}
                          </Link>
                        ) : (
                          '—'
                        )}
                        {location && location.name !== group?.name ? (
                          <span className="block text-xs text-fg-subtle">
                            {location.name}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          value={row.status}
                          tone={appointmentStatusTone(row.status)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill value={row.outcome} tone={outcomeTone(row.outcome)} />
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {row.booked_by_name ?? row.attribution_source ?? '—'}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {row.value_cents === null
                          ? '—'
                          : formatMoney(row.value_cents, group?.currency ?? 'USD')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-fg-subtle">
        Newest 400 in the range. Outcomes and treatment values are entered by
        the practice in its portal — the agency can see that someone booked and
        whether they turned up, but only the clinic knows what they went ahead
        with.
      </p>
    </>
  );
}
