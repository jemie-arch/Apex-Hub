'use client';

import { RotateCw } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  retryProvisioning,
  type RetryResult,
} from '@/app/(app)/onboarding/provisioning/actions';
import { cn } from '@/lib/cn';

/**
 * Retries one sub-account build.
 *
 * Safe to press twice: if the previous attempt created the account, the retry
 * configures that one rather than making a second. Disabled when the attempt has
 * no submission behind it, because there would be no answers to build from.
 */
export function RetryProvisioning({
  runId,
  disabled = false,
}: {
  runId: string;
  disabled?: boolean;
}) {
  const [result, setResult] = useState<RetryResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            setResult(await retryProvisioning({ runId }));
          })
        }
        title={
          disabled
            ? 'No submission attached, so there are no answers to rebuild from'
            : 'Build again — configures the existing account if one was made'
        }
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
      >
        <RotateCw size={12} className={pending ? 'animate-spin' : undefined} />
        {pending ? 'Building…' : 'Retry'}
      </button>

      {result ? (
        <p
          className={cn(
            'mt-1.5 max-w-xs text-[11px]',
            result.ok ? 'text-positive' : 'text-negative',
          )}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
