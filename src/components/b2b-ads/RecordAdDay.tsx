'use client';

import { Plus } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';

import { recordAdDay, type AdDayResult } from '@/app/(app)/b2b-ads/actions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

const FIELD =
  'h-10 w-full rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle';

/** Counts, in the order the funnel actually happens. */
const NUMBERS: Array<{ name: string; label: string; hint?: string }> = [
  { name: 'impressions', label: 'Impressions' },
  { name: 'clicks', label: 'Clicks' },
  { name: 'leads', label: 'Leads' },
  { name: 'bookings', label: 'Strategy sessions booked' },
  { name: 'showed', label: 'Showed' },
  { name: 'qualified_calls', label: 'Qualified calls' },
  { name: 'closed', label: 'Closed' },
];

export function RecordAdDay() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<AdDayResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function submit() {
    const form = formRef.current;
    if (!form) return;

    const data = new FormData(form);
    startTransition(async () => {
      const outcome = await recordAdDay(data);
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
        Record a day
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record a day"
        subtitle="Spend and outcomes for one ad on one day"
        size="lg"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={isPending} onClick={submit}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        {result && !result.ok ? (
          <p className="mb-4 rounded-md bg-negative-subtle px-3 py-2 text-sm text-negative">
            {result.message}
          </p>
        ) : null}

        <form ref={formRef} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Date</span>
            <input name="day" type="date" required className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Platform</span>
            <input name="platform" className={FIELD} placeholder="meta" />
          </label>
          <label className="flex flex-col gap-1.5 col-span-2">
            <span className="text-xs font-medium text-fg-muted">Campaign</span>
            <input name="campaign_name" required className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5 col-span-2">
            <span className="text-xs font-medium text-fg-muted">Ad</span>
            <input name="ad_name" className={FIELD} placeholder="(all ads)" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Spend ($)</span>
            <input name="spend" inputMode="decimal" className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">
              Cash collected ($)
            </span>
            <input name="cash_collected" inputMode="decimal" className={FIELD} />
          </label>

          {NUMBERS.map((field) => (
            <label key={field.name} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">
                {field.label}
              </span>
              <input
                name={field.name}
                inputMode="numeric"
                className={FIELD}
                placeholder="0"
              />
            </label>
          ))}
        </form>

        <p className="mt-4 text-xs text-fg-subtle">
          Entering the same date, platform, campaign and ad again corrects that
          day rather than adding a second one. Cost per lead, show rate and ROAS
          are worked out from these figures — they are never typed in, so they
          cannot disagree with them.
        </p>
      </Modal>
    </>
  );
}
