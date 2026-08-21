'use client';

import { useState, useTransition } from 'react';

import {
  setClientAdAccount,
  type MapResult,
} from '@/app/(app)/settings/ad-accounts/actions';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';

export interface AccountOption {
  id: string;
  name: string | null;
  spendCents: number;
  /** The practice already holding it, if any. */
  takenBy: string | null;
}

/**
 * One row's picker.
 *
 * Saves on change rather than behind a Save button: there are 60-odd practices
 * to work through, and a per-row save button would mean 120 clicks. The result
 * is shown inline so a refusal — the account is already mapped elsewhere — is
 * attached to the row it concerns.
 */
export function AdAccountPicker({
  clientId,
  current,
  options,
}: {
  clientId: string;
  current: string | null;
  options: AccountOption[];
}) {
  const [value, setValue] = useState(current ?? '');
  const [result, setResult] = useState<MapResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <span className="flex flex-col items-end gap-1">
      <select
        value={value}
        disabled={isPending}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          startTransition(async () => {
            const outcome = await setClientAdAccount({
              clientId,
              accountId: next,
            });
            setResult(outcome);
            // A refusal must not leave the box showing a mapping that was not
            // made.
            if (!outcome.ok) setValue(current ?? '');
          });
        }}
        className={cn(
          'h-9 w-64 rounded-md border bg-surface-sunken px-2 text-xs text-fg',
          result && !result.ok ? 'border-negative' : 'border-line',
          isPending && 'opacity-60',
        )}
        aria-label="Windsor ad account"
      >
        <option value="">Not mapped</option>
        {options.map((option) => (
          <option
            key={option.id}
            value={option.id}
            disabled={option.takenBy !== null && option.id !== current}
          >
            {option.name ?? option.id}
            {option.spendCents > 0
              ? ` · ${formatMoney(option.spendCents)}`
              : ' · no spend'}
            {option.takenBy !== null && option.id !== current
              ? ` — ${option.takenBy}`
              : ''}
          </option>
        ))}
      </select>

      {result ? (
        <span
          className={cn(
            'text-[11px]',
            result.ok ? 'text-positive' : 'text-negative',
          )}
        >
          {result.message}
        </span>
      ) : null}
    </span>
  );
}
