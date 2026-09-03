import { LifeBuoy, MessageSquare, Slack } from 'lucide-react';
import Link from 'next/link';

import {
  AddTechCall,
  ConfirmTechCall,
  TechCallStatusButtons,
} from '@/components/tech/TechCallControls';
import {
  TicketAssignee,
  TicketPriority,
  TicketStatusButtons,
  type Person,
} from '@/components/tech/TicketControls';
import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { ASSIGNABLE_ROLES } from '@/config/roles';
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

/** Urgent is red because it is urgent, not because red is on brand. */
function priorityTone(priority: string): Tone {
  switch (priority) {
    case 'urgent':
      return 'negative';
    case 'high':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * Tech support, in two halves.
 *
 * TICKETS are pieces of work. Most arrive by somebody tagging @apex in Slack —
 * see /api/slack/events — and land assigned to whoever
 * TECH_SUPPORT_ASSIGNEE_EMAIL names, which is Ally.
 *
 * TECH CALLS are bookings with a clinic. They have a time and a confirm step,
 * because confirming is when somebody is told to be somewhere.
 *
 * They are deliberately not the same table. A ticket cannot be a no-show and a
 * call cannot be resolved, and one enum covering both would offer every status
 * on every row.
 */
export default async function TechSupportPage() {
  const db = serviceClient();

  const [tickets, calls, groups, staff] = await Promise.all([
    db
      .from('tech_tickets')
      .select(
        'id, client_group_id, title, body, status, priority, assigned_to, raised_by_name, source, slack_channel_name, slack_permalink, resolution, resolved_at, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(200),
    db
      .from('tech_calls')
      .select(
        'id, client_group_id, requested_by, contact_email, contact_phone, topic, detail, requested_at, scheduled_at, status, resolution',
      )
      .order('requested_at', { ascending: false })
      .limit(200),
    db.from('client_groups').select('id, name').order('name'),
    db
      .from('user_profiles')
      .select('id, full_name, email, role')
      .in('role', [...ASSIGNABLE_ROLES])
      .order('full_name'),
  ]);

  if (tickets.error) throw tickets.error;
  if (calls.error) throw calls.error;
  if (groups.error) throw groups.error;
  if (staff.error) throw staff.error;

  const groupById = new Map((groups.data ?? []).map((row) => [row.id, row.name]));
  const zone = tenant.defaultTimezone;

  const people: Person[] = (staff.data ?? []).map((row) => ({
    id: row.id,
    // Somebody who has never set a name is still assignable; their email is
    // the only thing that identifies them, so it is what gets shown.
    name: row.full_name?.trim() || row.email,
  }));
  const personById = new Map(people.map((person) => [person.id, person.name]));

  const ticketRows = tickets.data ?? [];
  const liveTickets = ticketRows.filter(
    (row) => row.status === 'open' || row.status === 'in_progress',
  );
  const doneTickets = ticketRows.filter(
    (row) => row.status !== 'open' && row.status !== 'in_progress',
  );
  const unassigned = liveTickets.filter((row) => row.assigned_to === null);

  const callRows = calls.data ?? [];
  const requested = callRows.filter((row) => row.status === 'requested');
  const confirmed = callRows.filter((row) => row.status === 'confirmed');
  const closed = callRows.filter(
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
        description="Tickets raised by tagging @apex in Slack, and tech calls booked with clinics"
        actions={<AddTechCall clients={clientOptions} />}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Open tickets"
          value={formatCount(liveTickets.length)}
          higherIsBetter={false}
          hint="raised and not yet resolved"
        />
        <KPICard
          label="Unassigned"
          value={formatCount(unassigned.length)}
          higherIsBetter={false}
          hint="nobody has picked these up"
        />
        <KPICard
          label="Calls to confirm"
          value={formatCount(requested.length)}
          higherIsBetter={false}
          hint="somebody is waiting on us"
        />
        <KPICard label="Calls confirmed" value={formatCount(confirmed.length)} />
      </section>

      {/* ------------------------------------------------------------------ */}
      <h2 className="mb-3 text-sm font-semibold text-fg">Tickets</h2>
      {liveTickets.length === 0 ? (
        <EmptyState
          title="Nothing open"
          description={
            'Tag @apex in any Slack channel the bot has been invited to and the ' +
            'message becomes a ticket here, assigned to Ally. Add #urgent, ' +
            '#high or #low to set the priority.'
          }
          icon={<MessageSquare size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <tbody>
              {liveTickets.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 align-top">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-fg">{row.title}</span>
                      {row.priority === 'normal' ? null : (
                        <StatusPill
                          value={row.priority}
                          tone={priorityTone(row.priority)}
                        />
                      )}
                      {row.status === 'in_progress' ? (
                        <StatusPill value="in_progress" tone="accent" />
                      ) : null}
                    </span>

                    <span className="block text-xs text-fg-subtle">
                      <ClientCell groupId={row.client_group_id} />
                      {row.raised_by_name ? ` · ${row.raised_by_name}` : ''}
                      {row.slack_channel_name ? ` · #${row.slack_channel_name}` : ''}
                    </span>

                    {row.body ? (
                      <span className="mt-1 block max-w-xl whitespace-pre-line text-xs text-fg-muted">
                        {row.body}
                      </span>
                    ) : null}

                    {row.slack_permalink ? (
                      <a
                        href={row.slack_permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-accent"
                      >
                        <Slack size={11} />
                        Open the thread
                      </a>
                    ) : null}
                  </td>

                  <td className="px-4 py-3 align-top">
                    <span className="flex flex-col items-start gap-1.5">
                      <TicketAssignee
                        id={row.id}
                        assignedTo={row.assigned_to}
                        people={people}
                      />
                      <TicketPriority id={row.id} priority={row.priority} />
                    </span>
                  </td>

                  <td className="numeric px-4 py-3 align-top text-xs text-fg-muted">
                    raised {formatDateTimeInZone(row.created_at, zone, 'd MMM')}
                  </td>

                  <td className="px-4 py-3 text-right align-top">
                    <TicketStatusButtons id={row.id} status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {doneTickets.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-fg">Closed tickets</h2>
          <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <tbody>
                {doneTickets.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 align-top text-fg">
                      {row.title}
                      <span className="block text-xs text-fg-subtle">
                        <ClientCell groupId={row.client_group_id} />
                        {row.assigned_to
                          ? ` · ${personById.get(row.assigned_to) ?? 'Unknown'}`
                          : ''}
                      </span>
                      {row.resolution ? (
                        <span className="mt-1 block max-w-xl text-xs text-fg-muted">
                          {row.resolution}
                        </span>
                      ) : null}
                    </td>
                    <td className="numeric px-4 py-3 align-top text-xs text-fg-muted">
                      {row.resolved_at
                        ? formatDateTimeInZone(row.resolved_at, zone, 'd MMM yyyy')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <span className="flex items-center justify-end gap-1.5">
                        <StatusPill
                          value={row.status}
                          tone={row.status === 'resolved' ? 'positive' : 'neutral'}
                        />
                        <TicketStatusButtons id={row.id} status={row.status} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      <h2 className="mb-3 mt-8 text-sm font-semibold text-fg">
        Tech calls · requests
      </h2>
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
          <h2 className="mb-3 text-sm font-semibold text-fg">
            Tech calls · confirmed
          </h2>
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
          <h2 className="mb-3 text-sm font-semibold text-fg">
            Tech calls · closed
          </h2>
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
