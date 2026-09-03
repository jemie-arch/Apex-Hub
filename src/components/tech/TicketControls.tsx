'use client';

import { useState, useTransition } from 'react';

import {
  assignTicket,
  setTicketPriority,
  setTicketStatus,
  type TechCallResult,
} from '@/app/(app)/tech-support/actions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

const SELECT =
  'h-7 rounded-md border border-line bg-surface-sunken px-2 text-xs text-fg';

export interface Person {
  id: string;
  name: string;
}

/**
 * Resolving asks for a note, because "what did you actually do" is the one
 * thing a closed ticket is worth keeping. Optional, though: a ticket that was
 * a misunderstanding has no resolution worth typing, and demanding one would
 * teach everybody to type a full stop.
 */
export function ResolveTicket({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        Resolve
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Resolve the ticket"
        subtitle="What fixed it, in a sentence"
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const outcome = await setTicketStatus({
                    id,
                    status: 'resolved',
                    resolution: note,
                  });
                  setError(outcome.ok ? null : outcome.message);
                  if (outcome.ok) setOpen(false);
                })
              }
            >
              {isPending ? 'Resolving…' : 'Resolve'}
            </Button>
          </>
        }
      >
        {error ? (
          <p className="mb-4 rounded-md bg-negative-subtle px-3 py-2 text-sm text-negative">
            {error}
          </p>
        ) : null}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            Resolution (optional)
          </span>
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg"
            placeholder="Reconnected the calendar and re-ran the sync"
          />
        </label>
      </Modal>
    </>
  );
}

export function TicketStatusButtons({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(next: string) {
    startTransition(async () => {
      const outcome: TechCallResult = await setTicketStatus({ id, status: next });
      setError(outcome.ok ? null : outcome.message);
    });
  }

  return (
    <span className="flex items-center justify-end gap-1.5">
      {error ? <span className="text-xs text-negative">{error}</span> : null}

      {status === 'open' ? (
        <Button size="sm" disabled={isPending} onClick={() => move('in_progress')}>
          Start
        </Button>
      ) : null}

      {status === 'open' || status === 'in_progress' ? (
        <>
          <ResolveTicket id={id} />
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => move('closed')}
          >
            Close
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => move('open')}
        >
          Reopen
        </Button>
      )}
    </span>
  );
}

/**
 * Who owns it.
 *
 * Every Slack ticket arrives on Ally. This exists for the two cases that
 * follow: handing one to somebody else, and the ticket that arrived unassigned
 * because TECH_SUPPORT_ASSIGNEE_EMAIL matched no Hub user.
 */
export function TicketAssignee({
  id,
  assignedTo,
  people,
}: {
  id: string;
  assignedTo: string | null;
  people: readonly Person[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex items-center gap-1.5">
      <select
        className={SELECT}
        defaultValue={assignedTo ?? ''}
        disabled={isPending}
        onChange={(event) => {
          const value = event.target.value;
          startTransition(async () => {
            const outcome = await assignTicket({
              id,
              userId: value === '' ? null : value,
            });
            setError(outcome.ok ? null : outcome.message);
          });
        }}
      >
        <option value="">Unassigned</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
      {error ? <span className="text-xs text-negative">{error}</span> : null}
    </span>
  );
}

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export function TicketPriority({
  id,
  priority,
}: {
  id: string;
  priority: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex items-center gap-1.5">
      <select
        className={SELECT}
        defaultValue={priority}
        disabled={isPending}
        onChange={(event) => {
          const value = event.target.value;
          startTransition(async () => {
            const outcome = await setTicketPriority({ id, priority: value });
            setError(outcome.ok ? null : outcome.message);
          });
        }}
      >
        {PRIORITIES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      {error ? <span className="text-xs text-negative">{error}</span> : null}
    </span>
  );
}
