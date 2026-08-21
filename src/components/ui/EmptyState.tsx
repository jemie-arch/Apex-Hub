import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  /** Say what to do about it, not just that there is nothing here. */
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
      {icon ? (
        <div className="mb-3 flex justify-center text-fg-subtle">{icon}</div>
      ) : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-fg-muted">
        {description}
      </p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
