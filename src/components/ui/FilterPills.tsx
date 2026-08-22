'use client';

import { cn } from '@/lib/cn';

export interface FilterOption<T extends string> {
  key: T;
  label: string;
  /** Shown after the label. Omit rather than passing nought. */
  count?: number;
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
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={value === option.key}
          className={cn(
            'rounded px-2.5 py-1 text-xs transition-colors',
            value === option.key
              ? 'bg-accent-subtle font-medium text-accent'
              : 'text-fg-muted hover:text-fg',
          )}
        >
          {option.label}
          {option.count !== undefined ? (
            <span
              className={cn(
                'numeric ml-1.5',
                value === option.key ? 'text-accent' : 'text-fg-subtle',
              )}
            >
              {option.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
