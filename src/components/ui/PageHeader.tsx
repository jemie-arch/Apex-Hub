import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  /** One line saying what this page answers. Not decoration. */
  description?: string;
  /** Filters, date range, primary action. */
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
