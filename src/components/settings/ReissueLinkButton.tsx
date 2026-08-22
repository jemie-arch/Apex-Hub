'use client';

/**
 * Issues a fresh set-password link for somebody who already has an account.
 *
 * Needed more often than it sounds: these links are single use and time
 * limited, so the first one having expired is the ordinary case, not a fault.
 * Also the way somebody locked out gets back in without anyone knowing or
 * setting their password for them.
 */
import { KeyRound } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  reissueSetPasswordLink,
  type AccessResult,
} from '@/app/(app)/settings/access/actions';
import { SetPasswordLink } from '@/components/settings/SetPasswordLink';

export function ReissueLinkButton({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  const [result, setResult] = useState<AccessResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            setResult(await reissueSetPasswordLink({ userId }));
          })
        }
        disabled={pending}
        title={`Generate a set-password link for ${name}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-60"
      >
        <KeyRound size={12} /> {pending ? 'Generating…' : 'New link'}
      </button>

      {result && !result.ok ? (
        <p className="mt-1.5 text-xs text-negative">{result.message}</p>
      ) : null}

      {result?.link ? <SetPasswordLink url={result.link} /> : null}
    </>
  );
}
