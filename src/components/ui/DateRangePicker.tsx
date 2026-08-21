'use client';

/**
 * Range selector. Writes ?from=&to= into the URL rather than holding state, so
 * every page is shareable and a server component can read the range directly.
 */
import { CalendarDays } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { PRESETS, type PresetKey } from '@/lib/range';

export function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const activePreset = searchParams.get('preset') ?? 'this_month';

  function apply(next: Record<string, string>): void {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
      setOpen(false);
    });
  }

  const current = PRESETS.find((preset) => preset.key === activePreset);

  return (
    <div className="relative">
      <Button
        icon={<CalendarDays size={15} />}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        disabled={isPending}
      >
        {current?.label ?? 'Custom range'}
      </Button>

      {open ? (
        <div
          className={cn(
            'absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-lg',
            'border border-line bg-surface-raised p-1 shadow-lg',
          )}
        >
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() =>
                apply({ preset: preset.key, from: '', to: '' })
              }
              className={cn(
                'block w-full rounded-md px-3 py-2 text-left text-sm',
                preset.key === activePreset
                  ? 'bg-accent-subtle font-medium text-accent'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              {preset.label}
            </button>
          ))}

          <div className="mt-1 border-t border-line px-3 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              Custom
            </p>
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const from = String(form.get('from') ?? '');
                const to = String(form.get('to') ?? '');
                if (from && to) apply({ preset: 'custom', from, to });
              }}
            >
              <input
                type="date"
                name="from"
                required
                defaultValue={searchParams.get('from') ?? ''}
                className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg"
              />
              <input
                type="date"
                name="to"
                required
                defaultValue={searchParams.get('to') ?? ''}
                className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-fg"
              />
              <Button type="submit" variant="primary" size="sm">
                Apply
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { PresetKey };
