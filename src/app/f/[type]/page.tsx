import { notFound } from 'next/navigation';

import { PublicForm } from '@/components/forms/PublicForm';
import { findPublicForm } from '@/config/public-forms';
import { tenant } from '@/config/tenant.config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { type: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export function generateMetadata({ params }: PageProps) {
  const definition = findPublicForm(params.type);

  return {
    title: definition?.title ?? 'Form',
    // A form link gets emailed around; it has no business in a search index.
    robots: { index: false, follow: false },
  };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The public forms — Kick-Off and Post Close.
 *
 * No login, by design: a practice fills the Post Close form before it has any
 * access to anything. A `?t=` portal token on the link attributes the answers
 * to that practice; without one the submission still lands, marked unmatched
 * on the Forms page, because a form somebody took the trouble to fill in is
 * worth more unmatched than lost.
 */
export default function PublicFormPage({ params, searchParams }: PageProps) {
  const definition = findPublicForm(params.type);
  if (!definition) notFound();

  const token = single(searchParams['t']) ?? null;

  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-contrast"
              aria-hidden
            >
              {tenant.company.initial}
            </span>
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {tenant.company.name}
            </p>
          </div>

          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">
            {definition.title}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-fg-muted">
            {definition.intro}
          </p>
        </header>

        <PublicForm definition={definition} token={token} />

        <footer className="mt-10 text-xs text-fg-subtle">
          Sent straight to your account team. Nothing here is shared outside{' '}
          {tenant.company.name}.
        </footer>
      </div>
    </main>
  );
}
