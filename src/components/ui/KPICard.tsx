import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { formatPercent } from '@/lib/format';

export interface KPICardProps {
  label: string;
  value: string;
  /** Fractional change against the previous period; null when unmeasurable. */
  delta?: number | null;
  /**
   * Whether a rise is good. Cost per booking going up is bad, so it passes
   * false and the same arrow turns red.
   */
  higherIsBetter?: boolean;
  /** Context under the number, e.g. "of 148 booked". */
  hint?: string;
  icon?: ReactNode;
  /** The one number the owner opens the app for. Renders outsized. */
  hero?: boolean;
}

export function KPICard({
  label,
  value,
  delta = undefined,
  higherIsBetter = true,
  hint,
  icon,
  hero = false,
}: KPICardProps) {
  const hasDelta = delta !== undefined && delta !== null;
  const flat = hasDelta && Math.abs(delta) < 0.005;
  const good = hasDelta && !flat && (delta > 0) === higherIsBetter;

  const DeltaIcon = !hasDelta || flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div
      className={cn(
        'rounded-lg border border-line bg-surface p-5 shadow-sm',
        hero && 'sm:col-span-2 sm:row-span-2 sm:p-7',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p
          className={cn(
            'font-medium text-fg-muted',
            hero ? 'text-sm uppercase tracking-wide' : 'text-sm',
          )}
        >
          {label}
        </p>
        {icon ? <span className="text-fg-subtle">{icon}</span> : null}
      </div>

      <p
        className={cn(
          'numeric mt-3 font-semibold tracking-tight text-fg',
          hero ? 'text-hero' : 'text-3xl',
        )}
      >
        {value}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        {hasDelta ? (
          <span
            className={cn(
              'numeric inline-flex items-center gap-1 rounded-full px-2 py-0.5',
              'text-xs font-medium',
              flat && 'bg-neutral-subtle text-fg-muted',
              !flat && good && 'bg-positive-subtle text-positive',
              !flat && !good && 'bg-negative-subtle text-negative',
            )}
          >
            <DeltaIcon size={13} aria-hidden />
            {flat ? 'flat' : formatPercent(Math.abs(delta), 0)}
          </span>
        ) : null}
        {hint ? <span className="text-xs text-fg-subtle">{hint}</span> : null}
      </div>
    </div>
  );
}
