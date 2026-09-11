import { CalendarClock } from 'lucide-react';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill, appointmentStatusTone } from '@/components/ui/StatusPill';
import { tenant } from '@/config/tenant.config';
import { chunk, ID_LOOKUP_BATCH } from '@/lib/chunk';
import { formatDateTimeInZone, zoneAbbreviation } from '@/lib/format';
import { resolvePortal } from '@/lib/portal';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Upcoming',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
}

/**
 * Who is coming in, soonest first.
 *
 * Deliberately separate from /appointments, which looks backwards and exists to
 * collect outcomes. This one looks forwards and asks nothing of the reader —
 * it is the page a practice opens on a Monday morning to see the week.
 *
 * That difference is why the two cannot be one page with a filter. A list that
 * mixes "tell us what happened" with "here is who is coming" makes the first
 * job easy to miss, and the outcome data is the reason the portal exists at
 * all.
 *
 * Times are rendered in each location's own timezone, with the zone named. A
 * practice in California reading a time silently rendered in UTC would arrive
 * at the wrong hour, and nothing on the page would tell them why.
 */
export default async function PortalConsultationsPage({ params }: PageProps) {
  const portal = await resolvePortal(params.token);
  if (!portal) notFound();

  const db = serviceClient();
  const rows: Array<{
    id: string;
    patient_name: string | null;
    scheduled_at: string;
    status: string;
    client_id: string;
  }> = [];

  // PostgREST puts an .in() list in the URL, so many locations are batched.
  for (const ids of chunk(portal.locationIds, ID_LOOKUP_BATCH)) {
    const result = await db
      .from('appointments')
      .select('id, patient_name, scheduled_at, status, client_id')
      .in('client_id', ids)
      .eq('funnel', 'b2c')
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(500);

    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
  }

  // Soonest first across every location, not just within each batch.
  rows.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  const locationById = new Map(portal.locations.map((row) => [row.id, row]));
  const showLocation = portal.locations.length > 1;
  const patient = tenant.vocabulary.endUser;
  const booking = tenant.vocabulary.booking;

  /*
   * Grouped by calendar day in the location's own zone, because "how many are
   * in on Thursday" is the question this page answers and counting rows in a
   * flat list to find out is work the page should have done.
   */
  const byDay = new Map<string, typeof rows>();
  for (const row of rows) {
    const zone = locationById.get(row.client_id)?.timezone ?? 'UTC';
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(row.scheduled_at));

    byDay.set(day, [...(byDay.get(day) ?? []), row]);
  }

  return (
    <>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-fg">Upcoming {booking.plural}</h2>
        <p className="mt-0.5 text-sm text-fg-muted">
          Everyone booked in from now on, soonest first. Once someone has been
          in, they move to {booking.singular} outcomes for you to tell us how it
          went.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={`No upcoming ${booking.plural}`}
          description={
            `Nobody is booked in yet. New ${booking.plural} appear here as soon ` +
            'as they are made, usually within a few minutes.'
          }
          icon={<CalendarClock size={22} />}
        />
      ) : (
        <div className="space-y-6">
          {[...byDay.entries()].map(([day, dayRows]) => {
            const zone =
              locationById.get(dayRows[0]!.client_id)?.timezone ?? 'UTC';

            return (
              <section key={day}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-fg">
                    {new Intl.DateTimeFormat('en-US', {
                      timeZone: zone,
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    }).format(new Date(dayRows[0]!.scheduled_at))}
                  </h3>
                  <span className="numeric text-xs text-fg-subtle">
                    {dayRows.length}{' '}
                    {dayRows.length === 1 ? booking.singular : booking.plural}
                  </span>
                </div>

                <div className="overflow-hidden rounded-lg border border-line bg-surface">
                  {dayRows.map((row) => {
                    const location = locationById.get(row.client_id);
                    const rowZone = location?.timezone ?? 'UTC';

                    return (
                      <div
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-fg">
                            {row.patient_name ?? `${patient.singular} booked`}
                          </div>
                          {showLocation && location ? (
                            <div className="mt-0.5 text-xs text-fg-subtle">
                              {location.name}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="numeric text-sm text-fg-muted">
                            {/* Time only — the day is already the heading. */}
                            {formatDateTimeInZone(row.scheduled_at, rowZone, 'HH:mm')}{' '}
                            <span className="text-fg-subtle">
                              {zoneAbbreviation(rowZone)}
                            </span>
                          </span>
                          <StatusPill
                            value={row.status}
                            tone={appointmentStatusTone(row.status)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
