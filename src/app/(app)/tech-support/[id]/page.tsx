import { ArrowLeft, Slack } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TicketComments, type TicketComment } from '@/components/tech/TicketComments';
import {
  TicketAssignee,
  TicketPriority,
  TicketStatusButtons,
  type Person,
} from '@/components/tech/TicketControls';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { ASSIGNABLE_ROLES } from '@/config/roles';
import { tenant } from '@/config/tenant.config';
import { formatDateTimeInZone } from '@/lib/format';
import { currentCaller } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ticket' };

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

function statusTone(status: string): Tone {
  switch (status) {
    case 'resolved':
      return 'positive';
    case 'in_progress':
      return 'accent';
    default:
      return 'neutral';
  }
}

/**
 * One ticket, and the conversation about it.
 *
 * This page exists because a notification needs somewhere to point. A bell that
 * says "Ally commented on X" and drops you on a list of forty tickets has told
 * you something happened without telling you where, which is most of the way to
 * useless — so every notification this app writes carries an href to here.
 *
 * Route permission is inherited: config/permissions maps the /tech-support
 * prefix to tech_support, and permissionForPath matches by longest prefix, so
 * this page is covered without a new key. Adding one would have meant nobody
 * held it and the page would have been invisible to everybody but admins.
 */
export default async function TicketPage({ params }: { params: { id: string } }) {
  const db = serviceClient();
  const caller = await currentCaller();

  const [ticket, staff] = await Promise.all([
    db
      .from('tech_tickets')
      .select(
        'id, client_group_id, title, body, status, priority, assigned_to, raised_by_name, source, slack_channel_name, slack_permalink, resolution, resolved_at, created_at',
      )
      .eq('id', params.id)
      .maybeSingle(),
    db
      .from('user_profiles')
      .select('id, full_name, email, role')
      .in('role', [...ASSIGNABLE_ROLES])
      .order('full_name'),
  ]);

  if (ticket.error) throw ticket.error;
  // 404 rather than an error page: a ticket deleted with its Slack message is a
  // page that legitimately no longer exists.
  if (!ticket.data) notFound();
  if (staff.error) throw staff.error;

  const row = ticket.data;

  const [comments, group] = await Promise.all([
    db
      .from('tech_ticket_comments')
      .select('id, author_id, author_name, body, created_at')
      .eq('ticket_id', row.id)
      .order('created_at', { ascending: true }),
    row.client_group_id
      ? db
          .from('client_groups')
          .select('name')
          .eq('id', row.client_group_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (comments.error) throw comments.error;

  const zone = tenant.defaultTimezone;

  const people: Person[] = (staff.data ?? []).map((person) => ({
    id: person.id,
    name: person.full_name?.trim() || person.email,
  }));

  const thread: TicketComment[] = (comments.data ?? []).map((comment) => ({
    id: comment.id,
    authorName: comment.author_name?.trim() || 'Somebody',
    body: comment.body,
    when: formatDateTimeInZone(comment.created_at, zone, 'd MMM, HH:mm'),
    isOwn: comment.author_id !== null && comment.author_id === caller?.id,
  }));

  return (
    <>
      <Link
        href="/tech-support"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-fg-subtle hover:text-accent"
      >
        <ArrowLeft size={13} />
        Tech Support
      </Link>

      <PageHeader
        title={row.title}
        description={
          [
            row.raised_by_name ? `Raised by ${row.raised_by_name}` : null,
            row.slack_channel_name ? `in #${row.slack_channel_name}` : null,
            `on ${formatDateTimeInZone(row.created_at, zone, 'd MMM yyyy')}`,
          ]
            .filter(Boolean)
            .join(' ')
        }
        actions={<TicketStatusButtons id={row.id} status={row.status} />}
      />

      <div className="panel rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill value={row.status} tone={statusTone(row.status)} />
          <StatusPill value={row.priority} tone={priorityTone(row.priority)} />

          <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
            Assigned
            <TicketAssignee
              id={row.id}
              assignedTo={row.assigned_to}
              people={people}
            />
          </span>

          <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
            Priority
            <TicketPriority id={row.id} priority={row.priority} />
          </span>

          {group.data?.name ? (
            <Link
              href={`/clients/${row.client_group_id}`}
              className="text-xs text-fg-subtle hover:text-accent"
            >
              {group.data.name}
            </Link>
          ) : null}

          {row.slack_permalink ? (
            <a
              href={row.slack_permalink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-accent"
            >
              <Slack size={12} />
              Open the thread
            </a>
          ) : null}
        </div>

        {row.body ? (
          <p className="mt-4 whitespace-pre-line text-sm text-fg-muted">{row.body}</p>
        ) : (
          <p className="mt-4 text-sm text-fg-subtle">
            No detail beyond the title — the whole request was one line.
          </p>
        )}

        {row.resolution ? (
          <p className="mt-4 rounded-md bg-positive-subtle px-3 py-2 text-sm text-positive">
            <span className="font-medium">Resolved</span>
            {row.resolved_at
              ? ` ${formatDateTimeInZone(row.resolved_at, zone, 'd MMM')}`
              : ''}
            : {row.resolution}
          </p>
        ) : null}
      </div>

      <TicketComments ticketId={row.id} comments={thread} people={people} />
    </>
  );
}
