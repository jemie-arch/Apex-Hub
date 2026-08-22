'use client';

import { RotateCw } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  provisionSubmission,
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
  submissionId,
  disabled = false,
}: {
  /** A previous attempt to repeat. Omit for a submission never attempted. */
  runId?: string;
  /** A submission with no attempt yet. */
  submissionId?: string;
  disabled?: boolean;
}) {
  const [result, setResult] = useState<RetryResult | null>(null);
  const [pending, startTransition] = useTransition();

  const isFirstAttempt = runId === undefined;

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            setResult(
              runId !== undefined
                ? await retryProvisioning({ runId })
                : submissionId !== undefined
                  ? await provisionSubmission({ submissionId })
                  : {
                      ok: false,
                      message: 'Nothing to build from.',
                    },
            );
          })
        }
        title={
          disabled
            ? 'No submission attached, so there are no answers to rebuild from'
            : isFirstAttempt
              ? 'Build the sub-account from these answers'
              : 'Build again — configures the existing account if one was made'
        }
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
      >
        <RotateCw size={12} className={pending ? 'animate-spin' : undefined} />
        {pending ? 'Building…' : isFirstAttempt ? 'Provision' : 'Retry'}
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
