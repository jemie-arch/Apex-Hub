'use client';

import { Slack } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { TicketComments, type TicketComment } from '@/components/tech/TicketComments';
import {
  TicketAssignee,
  TicketPriority,
  TicketStatusButtons,
  type Person,
} from '@/components/tech/TicketControls';
import { Modal } from '@/components/ui/Modal';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';

export interface TicketSummary {
  id: string;
  title: string;
  body: string | null;
  status: string;
  priority: string;
  assignedTo: string | null;
  raisedByName: string | null;
  channelName: string | null;
  permalink: string | null;
  clientGroupId: string | null;
  clientName: string | null;
  raisedWhen: string;
  resolution: string | null;
}

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
 * A ticket, opened over the list.
 *
 * A modal rather than a page, which is the rule the whole app follows — see the
 * note at the top of ui/Modal: every detail view is a centred modal, so opening
 * a record never reflows what is behind it. This was a separate page first, and
 * that was simply the wrong shape for this codebase.
 *
 * /tech-support/<id> still exists and renders the same thing, because a
 * notification needs a URL to point at and a modal has none. So the bell deep
 * links to the page, clicking a row opens the modal, and both show the same
 * ticket. The modal carries a link across to the page for anybody who wants
 * something to paste into Slack.
 *
 * Comments arrive with the ticket rather than being fetched when the modal
 * opens. One query for the whole page instead of one per ticket, and no spinner
 * on a panel that should feel instant. It costs reading comments nobody opens,
 * which for a support queue of this size is nothing.
 */
export function TicketDetail({
  ticket,
  comments,
  people,
  children,
}: {
  ticket: TicketSummary;
  comments: readonly TicketComment[];
  people: readonly Person[];
  /** The clickable thing in the row — usually the title. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-left font-medium text-fg hover:text-accent"
      >
        {children}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={ticket.title}
        subtitle={[
          ticket.raisedByName ? `Raised by ${ticket.raisedByName}` : null,
          ticket.channelName ? `in #${ticket.channelName}` : null,
          ticket.raisedWhen,
        ]
          .filter(Boolean)
          .join(' · ')}
        size="lg"
        footer={
          <>
            <Link
              href={`/tech-support/${ticket.id}`}
              className="mr-auto text-xs text-fg-subtle hover:text-accent"
            >
              Open as a page
            </Link>
            <TicketStatusButtons id={ticket.id} status={ticket.status} />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill value={ticket.status} tone={statusTone(ticket.status)} />
          <StatusPill value={ticket.priority} tone={priorityTone(ticket.priority)} />

          <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
            Assigned
            <TicketAssignee
              id={ticket.id}
              assignedTo={ticket.assignedTo}
              people={people}
            />
          </span>

          <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
            Priority
            <TicketPriority id={ticket.id} priority={ticket.priority} />
          </span>

          {ticket.clientName && ticket.clientGroupId ? (
            <Link
              href={`/clients/${ticket.clientGroupId}`}
              className="text-xs text-fg-subtle hover:text-accent"
            >
              {ticket.clientName}
            </Link>
          ) : null}

          {ticket.permalink ? (
            <a
              href={ticket.permalink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-accent"
            >
              <Slack size={12} />
              Open the thread
            </a>
          ) : null}
        </div>

        {ticket.body ? (
          <p className="mt-4 whitespace-pre-line text-sm text-fg-muted">
            {ticket.body}
          </p>
        ) : (
          <p className="mt-4 text-sm text-fg-subtle">
            No detail beyond the title — the whole request was one line.
          </p>
        )}

        {ticket.resolution ? (
          <p className="mt-4 rounded-md bg-positive-subtle px-3 py-2 text-sm text-positive">
            <span className="font-medium">Resolved</span>: {ticket.resolution}
          </p>
        ) : null}

        <TicketComments
          ticketId={ticket.id}
          comments={comments}
          people={people}
        />
      </Modal>
    </>
  );
}
