'use client';

import { Plus } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';

import { createLead, type LeadResult } from '@/app/(app)/leads/actions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';

const FIELD =
  'h-10 w-full rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle';

export function AddLead() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<LeadResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function submit() {
    const form = formRef.current;
    if (!form) return;

    const data = new FormData(form);
    startTransition(async () => {
      const outcome = await createLead(data);
      setResult(outcome);
      if (outcome.ok) {
        form.reset();
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Button
        variant="primary"
        icon={<Plus size={14} />}
        onClick={() => setOpen(true)}
      >
        Add lead
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a lead"
        subtitle="For the ones that arrive by phone or referral rather than through an ad"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={isPending} onClick={submit}>
              {isPending ? 'Saving…' : 'Add lead'}
            </Button>
          </>
        }
      >
        {result && !result.ok ? (
          <p className="mb-4 rounded-md bg-negative-subtle px-3 py-2 text-sm text-negative">
            {result.message}
          </p>
        ) : null}

        <form ref={formRef} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Name</span>
            <input name="name" className={FIELD} placeholder="Dr Alice Nguyen" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Practice</span>
            <input
              name="practice_name"
              className={FIELD}
              placeholder="Riverside Orthodontics"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Email</span>
            <input name="email" type="email" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Phone</span>
            <input name="phone" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Channel</span>
            <input
              name="channel"
              className={FIELD}
              placeholder="referral, phone, event…"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Campaign</span>
            <input name="campaign_name" className={FIELD} />
          </label>
          <label className={cn('flex flex-col gap-1.5', 'sm:col-span-2')}>
            <span className="text-xs font-medium text-fg-muted">Notes</span>
            <textarea
              name="notes"
              rows={3}
              className="w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg placeholder:text-fg-subtle"
              placeholder="How they came to us, what they asked for."
            />
          </label>
        </form>

        <p className="mt-4 text-xs text-fg-subtle">
          One of name, email or phone is required. A row with none of them
          identifies nobody, so the database refuses it.
        </p>
      </Modal>
    </>
  );
}
