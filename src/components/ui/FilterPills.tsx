'use client';

import Link from 'next/link';

import { cn } from '@/lib/cn';

export interface FilterOption<T extends string> {
  key: T;
  label: string;
  /** Shown after the label. Omit rather than passing nought. */
  count?: number;
}

/**
 * The pill itself, shared by both modes below.
 *
 * Extracted rather than duplicated: the comment on this file already warns that
 * three near-copies of a control drift apart, and adding a second mode by
 * copying the markup would have proved it.
 */
function pillClass(selected: boolean): string {
  return cn(
    'rounded px-2.5 py-1 text-xs transition-colors',
    selected
      ? 'bg-accent-subtle font-medium text-accent'
      : 'text-fg-muted hover:text-fg',
  );
}

function countClass(selected: boolean): string {
  return cn('numeric ml-1.5', selected ? 'text-accent' : 'text-fg-subtle');
}

/**
 * The same control, but each pill is a link rather than a button.
 *
 * For tables that live in a server component, where the filter belongs in the
 * URL anyway: it survives a reload, it can be linked to somebody, and the page
 * keeps rendering on the server instead of shipping the whole table to the
 * client just to hide rows.
 */
export function FilterPillLinks<T extends string>({
  options,
  value,
  hrefFor,
  className,
}: {
  options: ReadonlyArray<FilterOption<T>>;
  value: T;
  hrefFor: (key: T) => string;
  className?: string;
}) {
  return (
    <div
      className={cn('flex rounded-md border border-line p-0.5', className)}
      role="group"
    >
      {options.map((option) => {
        const selected = value === option.key;
        return (
          <Link
            key={option.key}
            href={hrefFor(option.key)}
            aria-current={selected ? 'page' : undefined}
            className={pillClass(selected)}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={countClass(selected)}>{option.count}</span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * A segmented control for narrowing a table.
 *
 * Extracted from the ads page so the three tables that now have one are the same
 * control rather than three near-copies that drift. Counts sit inside the pill
 * because "Needs a decision 12" answers the question the filter is asking before
 * you press it.
 */
export function FilterPills<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<FilterOption<T>>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn('flex rounded-md border border-line p-0.5', className)}
      role="group"
    >
      {options.map((option) => {
        const selected = value === option.key;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            aria-pressed={selected}
            className={pillClass(selected)}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={countClass(selected)}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
