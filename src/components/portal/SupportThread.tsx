'use client';

import { useState, useTransition } from 'react';

import {
  raiseSupportTicket,
  replyToSupportTicket,
  type PortalResult,
} from '@/app/portal/[token]/portal-actions';
import { Button } from '@/components/ui/Button';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { cn } from '@/lib/cn';

const FIELD =
  'w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg placeholder:text-fg-subtle';

export interface SupportComment {
  id: string;
  authorName: string | null;
  body: string;
  createdAt: string;
  /** Whether this came from the practice rather than from us. */
  fromPractice: boolean;
}

export interface SupportTicket {
  id: string;
  title: string;
  body: string | null;
  status: string;
  createdAt: string;
  resolution: string | null;
  comments: SupportComment[];
}

function statusTone(status: string): Tone {
  if (status === 'resolved' || status === 'closed') return 'positive';
  if (status === 'in_progress') return 'accent';
  return 'warning';
}

function statusLabel(status: string): string {
  if (status === 'in_progress') return 'We are on it';
  if (status === 'resolved') return 'Resolved';
  if (status === 'closed') return 'Closed';
  return 'Open';
}

/** Local date rendering only — a practice reads this in its own browser. */
function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Notice({ result }: { result: PortalResult | null }) {
  if (!result) return null;
  return (
    <p
      className={cn(
        'mb-4 rounded-md px-3 py-2 text-sm',
        result.ok
          ? 'bg-positive-subtle text-positive'
          : 'bg-negative-subtle text-negative',
      )}
    >
      {result.message}
    </p>
  );
}

/**
 * Raising a new request.
 *
 * No priority field, deliberately — see raiseSupportTicket. No category picker
 * either: a practice describing the problem in its own words is more use to
 * whoever picks it up than a dropdown guessed from a list written by us.
 */
function NewTicket({ token }: { token: string }) {
  const [result, setResult] = useState<PortalResult | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="mb-6">
        <Button variant="primary" onClick={() => setOpen(true)}>
          Ask us something
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        startTransition(async () => {
          const outcome = await raiseSupportTicket(token, data);
          setResult(outcome);
          if (outcome.ok) {
            form.reset();
            setOpen(false);
          }
        });
      }}
      className="mb-6 rounded-lg border border-line bg-surface p-5"
    >
      <Notice result={result} />

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            What do you need?
          </span>
          <input
            name="title"
            required
            maxLength={160}
            className={FIELD}
            placeholder="Calls are not coming through to the front desk"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            Tell us more
          </span>
          <textarea
            name="body"
            required
            rows={5}
            className={FIELD}
            placeholder="When it started, what you were expecting, and anything you have already tried."
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Your name</span>
          <input name="raised_by_name" className={FIELD} />
        </label>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  );
}

function Reply({ token, ticketId }: { token: string; ticketId: string }) {
  const [result, setResult] = useState<PortalResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        data.set('ticket_id', ticketId);
        startTransition(async () => {
          const outcome = await replyToSupportTicket(token, data);
          setResult(outcome);
          if (outcome.ok) form.reset();
        });
      }}
      className="border-t border-line bg-surface-sunken px-4 py-3"
    >
      <Notice result={result} />
      <textarea
        name="body"
        required
        rows={2}
        className={FIELD}
        placeholder="Add to this conversation…"
      />
      <div className="mt-2 flex justify-end">
        <Button type="submit" variant="secondary" disabled={isPending}>
          {isPending ? 'Sending…' : 'Reply'}
        </Button>
      </div>
    </form>
  );
}

function Ticket({ token, ticket }: { token: string; ticket: SupportTicket }) {
  const settled = ticket.status === 'resolved' || ticket.status === 'closed';

  return (
    <article className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="font-medium text-fg">{ticket.title}</h3>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Raised {when(ticket.createdAt)}
          </p>
        </div>
        <StatusPill value={statusLabel(ticket.status)} tone={statusTone(ticket.status)} />
      </header>

      {ticket.body ? (
        <p className="whitespace-pre-wrap px-4 py-3 text-sm text-fg-muted">
          {ticket.body}
        </p>
      ) : null}

      {ticket.comments.length > 0 ? (
        <div className="space-y-3 border-t border-line px-4 py-3">
          {ticket.comments.map((comment) => (
            <div key={comment.id} className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'text-xs font-medium',
                    comment.fromPractice ? 'text-fg-muted' : 'text-accent',
                  )}
                >
                  {comment.fromPractice
                    ? (comment.authorName ?? 'You')
                    : (comment.authorName ?? 'Apex')}
                </span>
                <span className="text-xs text-fg-subtle">
                  {when(comment.createdAt)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-fg">{comment.body}</p>
            </div>
          ))}
        </div>
      ) : null}

      {ticket.resolution ? (
        <p className="border-t border-line bg-positive-subtle px-4 py-3 text-sm text-positive">
          {ticket.resolution}
        </p>
      ) : null}

      {/*
        A settled ticket keeps its thread but loses the reply box. Reopening by
        adding to a closed conversation means a message that nobody is watching
        for — raising a new one puts it back in the queue where it is seen.
      */}
      {settled ? null : <Reply token={token} ticketId={ticket.id} />}
    </article>
  );
}

export function SupportThread({
  token,
  tickets,
}: {
  token: string;
  tickets: SupportTicket[];
}) {
  return (
    <>
      <NewTicket token={token} />

      {tickets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-fg-subtle">
          Nothing open. Anything you send us appears here with our replies.
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => (
            <Ticket key={ticket.id} token={token} ticket={ticket} />
          ))}
        </div>
      )}
    </>
  );
}
