import { LifeBuoy } from 'lucide-react';
import Link from 'next/link';

import {
  AddTechCall,
  ConfirmTechCall,
  TechCallStatusButtons,
} from '@/components/tech/TechCallControls';
import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { tenant } from '@/config/tenant.config';
import { formatCount, formatDateTimeInZone } from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Tech Support' };

/** For the datetime-local input, which wants `YYYY-MM-DDTHH:mm` and no zone. */
function forPicker(iso: string | null): string | null {
  if (iso === null) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 16);
}

/**
 * Clinic tech calls: what has been asked for, what is confirmed, what happened.
 *
 * Requests sit at the top because an unconfirmed request is the only state on
 * this page with somebody waiting at the other end of it.
 */
export default async function TechSupportPage() {
  const db = serviceClient();

  const [calls, groups] = await Promise.all([
    db
      .from('tech_calls')
      .select(
        'id, client_group_id, requested_by, contact_email, contact_phone, topic, detail, requested_at, scheduled_at, status, resolution',
      )
      .order('requested_at', { ascending: false })
      .limit(200),
    db.from('client_groups').select('id, name').order('name'),
  ]);

  if (calls.error) throw calls.error;
  if (groups.error) throw groups.error;

  const groupById = new Map((groups.data ?? []).map((row) => [row.id, row.name]));
  const rows = calls.data ?? [];
  const zone = tenant.defaultTimezone;

  const requested = rows.filter((row) => row.status === 'requested');
  const confirmed = rows.filter((row) => row.status === 'confirmed');
  const closed = rows.filter(
    (row) => row.status !== 'requested' && row.status !== 'confirmed',
  );

  const clientOptions = (groups.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }));

  function ClientCell({ groupId }: { groupId: string | null }) {
    if (groupId === null) {
      return <span className="text-fg-subtle">unassigned</span>;
    }

    return (
      <Link href={`/clients/${groupId}`} className="hover:text-accent">
        {groupById.get(groupId) ?? 'Unknown'}
      </Link>
    );
  }

  return (
    <>
      <PageHeader
        title="Tech Support"
        description={`Tech calls booked by ${tenant.vocabulary.client.plural}, confirmed from here`}
        actions={<AddTechCall clients={clientOptions} />}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KPICard
          label="Waiting to be confirmed"
          value={formatCount(requested.length)}
          higherIsBetter={false}
          hint="somebody is waiting on us"
        />
        <KPICard label="Confirmed" value={formatCount(confirmed.length)} />
        <KPICard
          label="Closed"
          value={formatCount(closed.length)}
          hint="completed, cancelled or no-show"
        />
      </section>

      <h2 className="mb-3 text-sm font-semibold text-fg">Requests</h2>
      {requested.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description={
            'Requests land here from the portal and from anything typed in by ' +
            'hand. Confirming one is a separate step, because that is when a ' +
            'clinic is told to be somewhere.'
          }
          icon={<LifeBuoy size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <tbody>
              {requested.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <span className="block font-medium text-fg">{row.topic}</span>
                    <span className="block text-xs text-fg-subtle">
                      <ClientCell groupId={row.client_group_id} />
                      {row.requested_by ? ` · ${row.requested_by}` : ''}
                    </span>
                    {row.detail ? (
                      <span className="mt-1 block max-w-xl text-xs text-fg-muted">
                        {row.detail}
                      </span>
                    ) : null}
                  </td>
                  <td className="numeric px-4 py-3 text-xs text-fg-muted">
                    asked {formatDateTimeInZone(row.requested_at, zone, 'd MMM')}
                    {row.scheduled_at ? (
                      <span className="block">
                        wants{' '}
                        {formatDateTimeInZone(row.scheduled_at, zone, 'd MMM, HH:mm')}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="flex items-center justify-end gap-1.5">
                      <ConfirmTechCall
                        id={row.id}
                        suggested={forPicker(row.scheduled_at)}
                      />
                      <TechCallStatusButtons id={row.id} status={row.status} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmed.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-fg">Confirmed</h2>
          <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <tbody>
                {confirmed.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <span className="block font-medium text-fg">
                        {row.topic}
                      </span>
                      <span className="block text-xs text-fg-subtle">
                        <ClientCell groupId={row.client_group_id} />
                      </span>
                    </td>
                    <td className="numeric px-4 py-3 text-fg-muted">
                      {row.scheduled_at
                        ? formatDateTimeInZone(row.scheduled_at, zone)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TechCallStatusButtons id={row.id} status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {closed.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-fg">Closed</h2>
          <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <tbody>
                {closed.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-fg">
                      {row.topic}
                      <span className="block text-xs text-fg-subtle">
                        <ClientCell groupId={row.client_group_id} />
                      </span>
                    </td>
                    <td className="numeric px-4 py-3 text-xs text-fg-muted">
                      {row.scheduled_at
                        ? formatDateTimeInZone(row.scheduled_at, zone, 'd MMM yyyy')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StatusPill
                        value={row.status}
                        tone={
                          row.status === 'completed'
                            ? 'positive'
                            : row.status === 'no_show'
                              ? 'negative'
                              : 'neutral'
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
