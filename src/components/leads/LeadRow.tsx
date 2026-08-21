'use client';

/**
 * The classification control on a lead row.
 *
 * A select rather than a modal: classifying is the one thing somebody does to
 * a lead dozens of times in a sitting, and opening a dialog for each would
 * make the common case the slow one.
 */
import { useTransition } from 'react';

import { classifyLead } from '@/app/(app)/leads/actions';
import { cn } from '@/lib/cn';
import { humanise } from '@/lib/format';

const OPTIONS = [
  'unclassified',
  'qualified',
  'unqualified',
  'nurture',
  'duplicate',
  'spam',
] as const;

const TONES: Record<string, string> = {
  qualified: 'text-positive',
  unqualified: 'text-fg-subtle',
  nurture: 'text-warning',
  duplicate: 'text-fg-subtle',
  spam: 'text-negative',
  unclassified: 'text-fg-muted',
};

export function LeadClassification({
  id,
  value,
}: {
  id: string;
  value: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      value={value}
      disabled={isPending}
      onChange={(event) => {
        const classification = event.target.value;
        startTransition(async () => {
          await classifyLead({ id, classification });
        });
      }}
      className={cn(
        'h-8 rounded-md border border-line bg-surface-sunken px-2 text-xs font-medium',
        TONES[value] ?? 'text-fg',
        isPending && 'opacity-60',
      )}
      aria-label="Classification"
    >
      {OPTIONS.map((option) => (
        <option key={option} value={option}>
          {humanise(option)}
        </option>
      ))}
    </select>
  );
}
