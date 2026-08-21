'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { PORTAL_PAGES } from '@/lib/portal';
import { cn } from '@/lib/cn';

/**
 * Tabs across the portal.
 *
 * The token stays in the path on every link, because it is the credential —
 * there is no session carrying it between pages.
 */
export function PortalNav({ token }: { token: string }) {
  const pathname = usePathname();
  const base = `/portal/${token}`;

  return (
    <nav className="mb-8 flex flex-wrap gap-1.5 border-b border-line pb-3">
      {PORTAL_PAGES.map((page) => {
        const href = `${base}${page.href}`;
        const active =
          page.href === ''
            ? pathname === base || pathname === `${base}/`
            : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={page.href}
            href={href}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-accent-subtle font-medium text-accent'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            {page.label}
          </Link>
        );
      })}
    </nav>
  );
}
