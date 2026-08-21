import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';

export interface Bar {
  label: string;
  value: number;
  /** Second, smaller value drawn inside the bar — e.g. showed within booked. */
  inner?: number;
  /** Marks the current, incomplete period so it is not read as a decline. */
  partial?: boolean;
}

/**
 * A plain CSS bar chart. No charting library: these are rectangles, and a
 * dependency that ships its own renderer to draw rectangles is not worth the
 * bundle.
 *
 * The inner bar is the honest part — showing "showed" nested inside "booked"
 * means the gap between them is visible at a glance rather than requiring the
 * reader to compare two separate charts.
 */
export function BarChart({
  bars,
  innerLabel,
  outerLabel,
}: {
  bars: Bar[];
  outerLabel: string;
  innerLabel?: string;
}) {
  const peak = Math.max(1, ...bars.map((bar) => bar.value));

  return (
    <div>
      <div className="flex items-end gap-2 sm:gap-3" style={{ height: 168 }}>
        {bars.map((bar) => {
          const height = Math.round((bar.value / peak) * 100);
          const innerHeight =
            bar.inner === undefined || bar.value === 0
              ? 0
              : Math.round((bar.inner / bar.value) * 100);

          return (
            <div
              key={bar.label}
              className="flex h-full flex-1 flex-col justify-end"
              title={
                `${bar.label}: ${formatCount(bar.value)} ${outerLabel}` +
                (bar.inner !== undefined && innerLabel
                  ? `, ${formatCount(bar.inner)} ${innerLabel}`
                  : '') +
                (bar.partial ? ' (month still in progress)' : '')
              }
            >
              <span className="numeric mb-1.5 block text-center text-[11px] text-fg-subtle">
                {bar.value === 0 ? '' : formatCount(bar.value)}
              </span>

              <div
                className={cn(
                  'relative w-full overflow-hidden rounded-md bg-chart-track',
                  // The in-progress month is hatched back so a partial count is
                  // not mistaken for a fall.
                  bar.partial && 'opacity-60',
                )}
                style={{ height: `${Math.max(height, 2)}%` }}
              >
                <div
                  className="absolute inset-x-0 bottom-0 rounded-md bg-chart-1"
                  style={{ height: '100%' }}
                />
                {bar.inner !== undefined ? (
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-md bg-chart-3"
                    style={{ height: `${innerHeight}%` }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-2 sm:gap-3">
        {bars.map((bar) => (
          <span
            key={bar.label}
            className="flex-1 text-center text-[11px] text-fg-subtle"
          >
            {bar.label}
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-chart-1" />
          {outerLabel}
        </span>
        {innerLabel ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-chart-3" />
            {innerLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}
