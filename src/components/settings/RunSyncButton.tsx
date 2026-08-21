'use client';

import { Play } from 'lucide-react';
import { useState, useTransition } from 'react';

import { runSyncNow, type RunSyncState } from '@/app/(app)/settings/actions';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export function RunSyncButton({
  name,
  label,
}: {
  name: string;
  label: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<RunSyncState | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        icon={<Play size={13} />}
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setState(null);
            try {
              setState(await runSyncNow(name));
            } catch (error) {
              setState({
                ok: false,
                message:
                  error instanceof Error ? error.message : 'Something went wrong.',
              });
            }
          })
        }
      >
        {isPending ? 'Running…' : label}
      </Button>

      {state ? (
        <span
          className={cn(
            'text-xs',
            state.ok ? 'text-positive' : 'text-negative',
          )}
        >
          {state.message}
        </span>
      ) : null}
    </div>
  );
}
