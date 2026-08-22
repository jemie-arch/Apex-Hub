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
   * Whether a rise is good. Cost per appointment going up is bad, so it passes
   * false and the same arrow turns red.
   */
  higherIsBetter?: boolean;
  /** Context under the number, e.g. "of 148 booked". */
  hint?: string;
  icon?: ReactNode;
  /**
   * The one number the owner opens the app for. Rendered outsized, and as the
   * single LIGHT panel on a dark page — the strongest emphasis available
   * without shouting, and it works even in a photograph of the screen.
   */
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

  const DeltaIcon =
    !hasDelta || flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div
      className={cn(
        // surface-3d carries the top rim of light and the hover lift. The hero
        // tile also gets the sheen, once, because it is the one thing on the
        // page that is allowed to draw the eye.
        'rounded-lg border p-5 surface-3d',
        hero
          ? 'sheen border-transparent bg-surface-invert sm:col-span-2 sm:row-span-2 sm:p-7'
          : 'border-line bg-surface',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p
          className={cn(
            'font-medium',
            hero
              ? 'text-sm uppercase tracking-wide text-invert-fg-muted'
              : 'text-sm text-fg-muted',
          )}
        >
          {label}
        </p>
        {icon ? (
          <span className={hero ? 'text-invert-fg-muted' : 'text-fg-subtle'}>
            {icon}
          </span>
        ) : null}
      </div>

      <p
        className={cn(
          'numeric mt-3 font-semibold tracking-tight',
          hero ? 'text-hero text-invert-fg' : 'text-3xl text-fg',
        )}
      >
        {value}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        {hasDelta ? (
          hero ? (
            /* On the light panel the pastel semantics wash out, so the delta
               is text in a darker tone rather than a filled chip. */
            <span
              className={cn(
                'numeric inline-flex items-center gap-1 text-sm font-semibold',
                flat && 'text-invert-fg-muted',
                !flat && good && 'text-positive-strong',
                !flat && !good && 'text-negative-strong',
              )}
            >
              <DeltaIcon size={15} aria-hidden />
              {flat ? 'flat' : formatPercent(Math.abs(delta), 0)}
            </span>
          ) : (
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
          )
        ) : null}
        {hint ? (
          <span
            className={cn(
              'text-xs',
              hero ? 'text-invert-fg-muted' : 'text-fg-subtle',
            )}
          >
            {hint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
