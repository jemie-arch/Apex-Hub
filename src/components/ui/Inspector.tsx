import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface InspectorMetric {
  label: string;
  value: string;
  /** Draws the eye to the one figure that answers the page's question. */
  accent?: boolean;
}

/**
 * The panel beside a table, showing the row you clicked.
 *
 * Deliberately a darker surface than the table rather than matching it, because
 * it is a different mode: the table is the whole picture, this is one row held up
 * to the light. Matching them would make the split look like an accident of
 * layout.
 *
 * Extracted from the ads page once three tables wanted one. The shell is shared —
 * the chip, the title, up to three headline figures — and each page supplies its
 * own body, because what is worth knowing about a practice is not what is worth
 * knowing about a consultation.
 */
export function Inspector({
  title,
  subtitle,
  status,
  metrics = [],
  children,
}: {
  title: string;
  subtitle?: string;
  /** A short state word, top right. */
  status?: string;
  metrics?: InspectorMetric[];
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <section className="surface-3d overflow-hidden rounded-lg border border-accent-subtle bg-surface-sunken p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            Inspecting
          </span>
          {status ? (
            <span className="text-[11px] text-fg-subtle">{status}</span>
          ) : null}
        </div>

        <h3 className="mt-2.5 truncate text-base font-semibold text-fg">{title}</h3>
        {subtitle ? (
          <p className="mt-0.5 truncate text-xs text-fg-subtle">{subtitle}</p>
        ) : null}

        {metrics.length > 0 ? (
          <div
            className={cn(
              'mt-3 grid gap-3',
              metrics.length >= 3 ? 'grid-cols-3' : 'grid-cols-2',
            )}
          >
            {metrics.map((metric) => (
              <div key={metric.label}>
                <p
                  className={cn(
                    'numeric text-lg font-semibold',
                    metric.accent ? 'text-accent' : 'text-fg',
                  )}
                >
                  {metric.value}
                </p>
                <p className="text-[11px] text-fg-subtle">{metric.label}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {children}
    </div>
  );
}

/** A titled block under the inspector head. Keeps the sections consistent. */
export function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel rounded-lg border border-line bg-surface p-4">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
        {title}
      </h4>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
