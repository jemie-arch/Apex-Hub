'use client';

import { CalendarCheck, Plus } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  createTechCall,
  setTechCallStatus,
  type TechCallResult,
} from '@/app/(app)/tech-support/actions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';

const FIELD =
  'h-10 w-full rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle';

function Banner({ result }: { result: TechCallResult | null }) {
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
 * Confirming a call needs a time, so it opens a dialog. Everything else is a
 * one-click status change.
 */
export function ConfirmTechCall({
  id,
  suggested,
}: {
  id: string;
  /** Pre-fills the picker with whatever time was requested, if any. */
  suggested: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(suggested ?? '');
  const [result, setResult] = useState<TechCallResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        size="sm"
        variant="primary"
        icon={<CalendarCheck size={13} />}
        onClick={() => setOpen(true)}
      >
        Confirm
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Confirm the call"
        subtitle="The clinic is told this time, so it has to be the real one"
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={isPending || when === ''}
              onClick={() =>
                startTransition(async () => {
                  const outcome = await setTechCallStatus({
                    id,
                    status: 'confirmed',
                    scheduledAt: when,
                  });
                  setResult(outcome);
                  if (outcome.ok) setOpen(false);
                })
              }
            >
              {isPending ? 'Confirming…' : 'Confirm'}
            </Button>
          </>
        }
      >
        <Banner result={result} />

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            Date and time
          </span>
          <input
            type="datetime-local"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            className={FIELD}
          />
        </label>
      </Modal>
    </>
  );
}

export function TechCallStatusButtons({
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
      const outcome = await setTechCallStatus({ id, status: next });
      setError(outcome.ok ? null : outcome.message);
    });
  }

  return (
    <span className="flex items-center justify-end gap-1.5">
      {error ? <span className="text-xs text-negative">{error}</span> : null}
      {status === 'confirmed' ? (
        <>
          <Button size="sm" disabled={isPending} onClick={() => move('completed')}>
            Done
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => move('no_show')}
          >
            No show
          </Button>
        </>
      ) : null}
      {status === 'requested' || status === 'confirmed' ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => move('cancelled')}
        >
          Cancel
        </Button>
      ) : null}
    </span>
  );
}

export function AddTechCall({
  clients,
}: {
  clients: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<TechCallResult | null>(null);

  return (
    <>
      <Button
        variant="primary"
        icon={<Plus size={14} />}
        onClick={() => setOpen(true)}
      >
        Add booking
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a tech call"
        subtitle="For a request that came in by email or phone"
      >
        <Banner result={result} />

        <form
          action={async (formData) => {
            const outcome = await createTechCall(formData);
            setResult(outcome);
            if (outcome.ok) setOpen(false);
          }}
          className="flex flex-col gap-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Client</span>
              <select name="client_group_id" className={FIELD} defaultValue="">
                <option value="">Unassigned</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">
                Who asked
              </span>
              <input name="requested_by" className={FIELD} placeholder="Name" />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Topic</span>
            <input
              name="topic"
              required
              className={FIELD}
              placeholder="Calendar not syncing"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Detail</span>
            <textarea
              name="detail"
              rows={3}
              className="w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Email</span>
              <input name="contact_email" type="email" className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Phone</span>
              <input name="contact_phone" className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">
                Preferred time
              </span>
              <input
                name="scheduled_at"
                type="datetime-local"
                className={FIELD}
              />
            </label>
          </div>

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Add
            </Button>
          </div>
        </form>

        <p className="mt-4 text-xs text-fg-subtle">
          Adding a booking does not confirm it. Confirming is a separate step,
          because it is the point at which somebody is told to be somewhere.
        </p>
      </Modal>
    </>
  );
}
