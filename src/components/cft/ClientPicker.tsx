'use client';

/**
 * Narrow the tracker mirror to one client.
 *
 * A select rather than the pill group the other two controls use, because there
 * are forty-two clients and pills would wrap into four rows above the table.
 *
 * Writes to the URL rather than holding state, the same way DateRangePicker
 * does: the filter survives a reload, the view can be sent to somebody, and the
 * table keeps rendering on the server instead of shipping forty-two clients'
 * rows to the browser so it can hide most of them.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { cn } from '@/lib/cn';

export function ClientPicker({
  clients,
}: {
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const current = searchParams.get('client') ?? '';

  return (
    <select
      value={current}
      disabled={isPending}
      onChange={(event) => {
        const params = new URLSearchParams(searchParams.toString());
        if (event.target.value) params.set('client', event.target.value);
        else params.delete('client');
        startTransition(() => router.push(`${pathname}?${params.toString()}`));
      }}
      className={cn(
        'rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-fg',
        isPending && 'opacity-60',
      )}
      aria-label="Client"
    >
      <option value="">All clients</option>
      {clients.map((client) => (
        <option key={client.id} value={client.id}>
          {client.name}
        </option>
      ))}
    </select>
  );
}
