import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { PortalNav } from '@/components/portal/PortalNav';
import { Logo } from '@/components/shell/Logo';
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
          {/*
            The practice's own name is the heading here, not Apex's — this page
            belongs to them. The wordmark says who is reporting, which is why it
            sits opposite as a signature rather than above as a title.
          */}
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            {portal.group.name}
          </h1>
          <Logo height={24} />
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
