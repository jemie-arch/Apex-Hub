'use client';

import { useState, useTransition } from 'react';

import {
  requestPortalInvite,
  type PortalResult,
} from '@/app/portal/[token]/portal-actions';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const FIELD =
  'h-10 w-full rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle';

/**
 * Asks for a colleague to be added.
 *
 * Deliberately a request rather than a grant: this link IS the credential, so
 * anybody who can forward it can already share access. Routing it through us
 * means the new person gets their own link, which can be revoked on its own.
 */
export function InviteRequestForm({ token }: { token: string }) {
  const [result, setResult] = useState<PortalResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        startTransition(async () => {
          const outcome = await requestPortalInvite(token, data);
          setResult(outcome);
          if (outcome.ok) form.reset();
        });
      }}
      className="max-w-xl rounded-lg border border-line bg-surface p-6"
    >
      {result ? (
        <p
          className={cn(
            'mb-5 rounded-md px-3 py-2 text-sm',
            result.ok
              ? 'bg-positive-subtle text-positive'
              : 'bg-negative-subtle text-negative',
          )}
        >
          {result.message}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Their name</span>
          <input name="name" required className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Their email</span>
          <input name="email" type="email" required className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            What they do
          </span>
          <input
            name="role"
            className={FIELD}
            placeholder="Treatment coordinator"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            Your name
          </span>
          <input name="requested_by" className={FIELD} />
        </label>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs text-fg-subtle">
          We send them their own link rather than sharing yours.
        </p>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Sending…' : 'Ask us'}
        </Button>
      </div>
    </form>
  );
}
