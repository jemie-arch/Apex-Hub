'use client';

/**
 * The two interactive parts of the Team page: asking for time off, and an
 * admin deciding a request.
 */
import { CalendarPlus, Check, X } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  decideTimeOff,
  requestTimeOff,
  saveEmployment,
  type TeamResult,
} from '@/app/(app)/hr/actions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { humanise } from '@/lib/format';

const FIELD =
  'h-10 w-full rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle';

const KINDS = ['vacation', 'sick', 'unpaid', 'parental', 'other'] as const;

function Banner({ result }: { result: TeamResult | null }) {
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

export function RequestTimeOff() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<TeamResult | null>(null);

  return (
    <>
      <Button
        variant="primary"
        icon={<CalendarPlus size={14} />}
        onClick={() => setOpen(true)}
      >
        Request time off
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Request time off"
        subtitle="Goes to an admin as pending"
      >
        <Banner result={result} />

        <form
          action={async (formData) => {
            const outcome = await requestTimeOff(formData);
            setResult(outcome);
            if (outcome.ok) setOpen(false);
          }}
          className="flex flex-col gap-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Kind</span>
              <select name="kind" className={FIELD} defaultValue="vacation">
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {humanise(kind)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">First day</span>
              <input name="starts_on" type="date" required className={FIELD} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Last day</span>
              <input name="ends_on" type="date" required className={FIELD} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Note</span>
            <textarea
              name="note"
              rows={2}
              className="w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg"
              placeholder="Anything the team needs to plan around."
            />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Send request
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DecideTimeOff({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(approve: boolean) {
    startTransition(async () => {
      const outcome = await decideTimeOff({ id, approve });
      setError(outcome.ok ? null : outcome.message);
    });
  }

  return (
    <span className="flex items-center justify-end gap-1.5">
      {error ? <span className="text-xs text-negative">{error}</span> : null}
      <Button
        size="sm"
        icon={<Check size={13} />}
        disabled={isPending}
        onClick={() => decide(true)}
      >
        Approve
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={<X size={13} />}
        disabled={isPending}
        onClick={() => decide(false)}
      >
        Decline
      </Button>
    </span>
  );
}

export function EditEmployment({
  userId,
  name,
  jobTitle,
  startedOn,
}: {
  userId: string;
  name: string;
  jobTitle: string | null;
  startedOn: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(jobTitle ?? '');
  const [started, setStarted] = useState(startedOn ?? '');
  const [result, setResult] = useState<TeamResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Edit
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={name}
        subtitle="Role and start date"
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const outcome = await saveEmployment({
                    userId,
                    jobTitle: title.trim() === '' ? null : title.trim(),
                    startedOn: started === '' ? null : started,
                  });
                  setResult(outcome);
                  if (outcome.ok) setOpen(false);
                })
              }
            >
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <Banner result={result} />

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Job title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={FIELD}
              placeholder="Media buyer"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Started</span>
            <input
              type="date"
              value={started}
              onChange={(event) => setStarted(event.target.value)}
              className={FIELD}
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
