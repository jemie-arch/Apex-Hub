import { MessagesSquare } from 'lucide-react';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/ui/EmptyState';
import {
  StatusPill,
  appointmentStatusTone,
} from '@/components/ui/StatusPill';
import { tenant } from '@/config/tenant.config';
import { formatDateTimeInZone } from '@/lib/format';
import { resolvePortal } from '@/lib/portal';
import { bounds, resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Calls with us',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
  searchParams: Record<string, string | string[] | undefined>;
}

interface Row {
  id: string;
  kind: string;
  topic: string;
  at: string | null;
  status: string;
}

/**
 * The practice's calls with US — as distinct from their patients' calls, which
 * are on the Consultations page. Two different funnels, so two different pages
 * rather than one mixed list nobody can read.
 */
export default async function PortalAgencyAppointmentsPage({
  params,
  searchParams,
}: PageProps) {
  const portal = await resolvePortal(params.token);
  if (!portal) notFound();

  /*
   * The portal's shared range. Both feeds on this page are dated, so both are
   * filtered — a picker that moved one list and not the other would be worse
   * than none, because the page would look inconsistent rather than filtered.
   */
  const single = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const window = bounds(range.from, range.to);

  const db = serviceClient();

  const [deals, techCalls] = await Promise.all([
    db.from('deals').select('id').eq('client_group_id', portal.group.id),
    db
      .from('tech_calls')
      .select('id, topic, scheduled_at, requested_at, status')
      .eq('client_group_id', portal.group.id)
      .gte('requested_at', window.start)
      .lte('requested_at', window.end)
      .order('requested_at', { ascending: false })
      .limit(100),
  ]);

  if (deals.error) throw deals.error;
  if (techCalls.error) throw techCalls.error;

  const dealIds = (deals.data ?? []).map((row) => row.id);

  const rows: Row[] = [];

  if (dealIds.length > 0) {
    const calls = await db
      .from('sales_calls')
      .select('id, scheduled_at, status, outcome')
      .in('deal_id', dealIds)
      .gte('scheduled_at', window.start)
      .lte('scheduled_at', window.end)
      .order('scheduled_at', { ascending: false })
      .limit(100);

    if (calls.error) throw calls.error;

    for (const call of calls.data ?? []) {
      rows.push({
        id: call.id,
        kind: 'Strategy session',
        topic: 'With your account team',
        at: call.scheduled_at,
        status: call.status,
      });
    }
  }

  for (const call of techCalls.data ?? []) {
    rows.push({
      id: call.id,
      kind: 'Tech call',
      topic: call.topic,
      at: call.scheduled_at ?? call.requested_at,
      status: call.status,
    });
  }

  rows.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));

  const zone = portal.locations[0]?.timezone ?? tenant.defaultTimezone;

  return (
    <>
      <h2 className="text-lg font-semibold text-fg">Calls with us</h2>
      <p className="mb-6 mt-0.5 text-sm text-fg-muted">
        Your calls with our team. Your patients&apos; consultations are on the
        Consultations page.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing booked"
          description={
            'Strategy sessions and tech calls appear here once they are in the ' +
            'calendar. Ask us for one any time — you do not have to wait to be ' +
            'offered.'
          }
          icon={<MessagesSquare size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.kind}-${row.id}`}
                  className="border-b border-line last:border-0"
                >
                  <td className="px-4 py-3">
                    <span className="block font-medium text-fg">{row.kind}</span>
                    <span className="block text-xs text-fg-subtle">
                      {row.topic}
                    </span>
                  </td>
                  <td className="numeric px-4 py-3 text-fg-muted">
                    {row.at === null
                      ? 'time to be confirmed'
                      : formatDateTimeInZone(row.at, zone)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StatusPill
                      value={row.status}
                      tone={appointmentStatusTone(row.status)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
