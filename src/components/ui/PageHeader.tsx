import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: string;
  /** One line saying what this page answers. Not decoration. */
  description?: string;
  /** Filters, date range, primary action. */
  actions?: ReactNode;
  /**
   * A small uppercase label above the title — the section this page belongs to.
   *
   * Gives the headline something to sit under so it reads as a statement rather
   * than a filename, which is the whole trick behind the layout this follows.
   */
  eyebrow?: string;
  /** A live count beside the eyebrow: "34 spending", "9 at risk". */
  pill?: {
    label: string;
    tone?: 'positive' | 'accent' | 'warning' | 'neutral';
  };
}

const PILL_TONES = {
  positive: 'bg-positive-subtle text-positive',
  accent: 'bg-accent-subtle text-accent',
  warning: 'bg-warning-subtle text-warning',
  neutral: 'bg-neutral-subtle text-fg-muted',
} as const;

const DOT_TONES = {
  positive: 'bg-positive',
  accent: 'bg-accent',
  warning: 'bg-warning',
  neutral: 'bg-fg-subtle',
} as const;

/**
 * The top of every page.
 *
 * The title is deliberately large. A dashboard page is read by somebody
 * arriving from somewhere else, and a heading the same size as the table
 * headings below it makes them hunt for what they are looking at.
 *
 * eyebrow and pill are optional so all 27 existing callers keep working
 * untouched and inherit the type scale; a page opts into the full treatment by
 * passing them.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  pill,
}: PageHeaderProps) {
  const tone = pill?.tone ?? 'positive';

  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow || pill ? (
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            {eyebrow}
            {pill ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5',
                  'text-[10px] font-medium normal-case tracking-normal',
                  PILL_TONES[tone],
                )}
              >
                <span
                  className={cn('h-1.5 w-1.5 rounded-full', DOT_TONES[tone])}
                  aria-hidden
                />
                {pill.label}
              </span>
            ) : null}
          </p>
        ) : null}

        <h1
          className={cn(
            'text-3xl font-semibold tracking-tight text-fg',
            eyebrow || pill ? 'mt-1.5' : '',
          )}
        >
          {title}
        </h1>

        {description ? (
          <p className="mt-1.5 max-w-3xl text-sm text-fg-muted">{description}</p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
