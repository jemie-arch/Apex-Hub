import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { PortalNav } from '@/components/portal/PortalNav';
import { tenant } from '@/config/tenant.config';
import { resolvePortal } from '@/lib/portal';

export const dynamic = 'force-dynamic';

// A portal link must never end up in a search index.
export const metadata = {
  title: 'Your results',
  robots: { index: false, follow: false },
};

/**
 * The chrome every portal page shares.
 *
 * The token is resolved here as well as in each page. That is not redundant
 * caution about rendering — it is what makes an invalid token a 404 for the
 * whole subtree, including pages that would otherwise render an empty but
 * real-looking form.
 */
export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { token: string };
}) {
  const portal = await resolvePortal(params.token);
  if (!portal) notFound();

  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {tenant.company.name}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">
              {portal.group.name}
            </h1>
          </div>
          <span
            className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-contrast"
            aria-hidden
          >
            {tenant.company.initial}
          </span>
        </header>

        <PortalNav token={params.token} />

        {children}

        <footer className="mt-12 border-t border-line pt-5 text-xs text-fg-subtle">
          This link is private to your practice. Anyone who has it can see this
          page, so please forward it only to people at{' '}
          {portal.group.name} who need it — or ask us to add them properly.
        </footer>
      </div>
    </main>
  );
}
