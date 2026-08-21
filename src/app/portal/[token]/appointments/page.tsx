import { CalendarCheck } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/ui/EmptyState';
import {
  StatusPill,
  appointmentStatusTone,
  outcomeTone,
} from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import { chunk, ID_LOOKUP_BATCH } from '@/lib/chunk';
import { formatDateTimeInZone, formatMoney } from '@/lib/format';
import { resolvePortal } from '@/lib/portal';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Your consultations',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
  searchParams: Record<string, string | string[] | undefined>;
}

/**
 * Every consultation, newest first, with the ones still missing an outcome
 * called out — those are what the practice is here to fill in.
 */
export default async function PortalAppointmentsPage({
  params,
  searchParams,
}: PageProps) {
  const portal = await resolvePortal(params.token);
  if (!portal) notFound();

  const onlyPending = searchParams['show'] === 'pending';

  const db = serviceClient();
  const rows: Array<{
    id: string;
    patient_name: string | null;
    scheduled_at: string;
    status: string;
    showed: boolean | null;
    outcome: string;
    value_cents: number | null;
    client_id: string;
  }> = [];

  // PostgREST puts an .in() list in the URL, so a practice with many locations
  // has to be asked for in batches.
  for (const ids of chunk(portal.locationIds, ID_LOOKUP_BATCH)) {
    let query = db
      .from('appointments')
      .select(
        'id, patient_name, scheduled_at, status, showed, outcome, value_cents, client_id',
      )
      .in('client_id', ids)
      .eq('funnel', 'b2c')
      .order('scheduled_at', { ascending: false })
      .limit(500);

    if (onlyPending) query = query.eq('outcome', 'pending');

    const result = await query;
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
  }

  rows.sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));

  const locationById = new Map(portal.locations.map((row) => [row.id, row]));
  const showLocation = portal.locations.length > 1;
  const patient = tenant.vocabulary.endUser;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg">
            Your {tenant.vocabulary.booking.plural}
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            Open one to tell us what happened. That is the only way we can
            report on treatment started, rather than just on who booked.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Link
            href={`/portal/${params.token}/appointments`}
            className={
              onlyPending
                ? 'rounded-md border border-line px-3 py-1.5 text-xs text-fg-muted hover:text-fg'
                : 'rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast'
            }
          >
            All
          </Link>
          <Link
            href={`/portal/${params.token}/appointments?show=pending`}
            className={
              onlyPending
                ? 'rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast'
                : 'rounded-md border border-line px-3 py-1.5 text-xs text-fg-muted hover:text-fg'
            }
          >
            Awaiting an outcome
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={onlyPending ? 'Nothing outstanding' : 'No consultations yet'}
          description={
            onlyPending
              ? 'Every consultation has an outcome recorded. Thank you.'
              : `New ${patient.plural} appear here as soon as they book.`
          }
          icon={<CalendarCheck size={22} />}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">
                    {titleCase(patient.singular)}
                  </th>
                  {showLocation ? (
                    <th className="px-4 py-3 font-medium">
                      {titleCase(tenant.vocabulary.location.singular)}
                    </th>
                  ) : null}
                  <th className="px-4 py-3 font-medium">Booking</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                  <th className="px-4 py-3 text-right font-medium">Value</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const location = locationById.get(row.client_id);
                  const zone = location?.timezone ?? tenant.defaultTimezone;

                  return (
                    <tr
                      key={row.id}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="numeric px-4 py-3 text-fg-muted">
                        {formatDateTimeInZone(row.scheduled_at, zone)}
                      </td>
                      <td className="px-4 py-3 font-medium text-fg">
                        {row.patient_name ?? 'Not given'}
                      </td>
                      {showLocation ? (
                        <td className="px-4 py-3 text-xs text-fg-muted">
                          {location?.name ?? 'Unknown'}
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <StatusPill
                          value={row.status}
                          tone={appointmentStatusTone(row.status)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          value={row.outcome}
                          tone={outcomeTone(row.outcome)}
                        />
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg">
                        {row.value_cents === null
                          ? '—'
                          : formatMoney(row.value_cents, portal.group.currency)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/portal/${params.token}/appointments/${row.id}`}
                          className="text-xs font-medium text-accent hover:underline"
                        >
                          {row.outcome === 'pending' ? 'Tell us' : 'Update'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
