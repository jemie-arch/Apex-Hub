import { PhoneCall } from 'lucide-react';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { PortalSwitcher } from '@/components/shell/PortalSwitcher';
import { currentCaller } from '@/lib/supabase/server';

/**
 * The call centre shell.
 *
 * Its own layout, with no internal sidebar, because this is a different job
 * rather than another page of the internal portal. An ISA works here all day and
 * has no business scrolling past the agency's finances to reach their queue —
 * and leaving the internal menu on screen made switching portals look like it
 * had not worked at all.
 *
 * The route is still /call-center: a route group in parentheses shapes the
 * layout without touching the URL, so existing links and the middleware
 * permission rule are unaffected.
 */
export default async function CallCenterLayout({
  children,
}: {
  children: ReactNode;
}) {
  const caller = await currentCaller();

  // Middleware guards the route; this covers a session expiring between that
  // check and this render.
  if (!caller) redirect('/login');

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg">
      <header className="flex shrink-0 items-center justify-between border-b border-line bg-surface px-6 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-contrast"
            aria-hidden
          >
            <PhoneCall size={15} />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">Call Center</p>
            <p className="text-xs text-fg-subtle">
              Calls and ISA performance
            </p>
          </div>
        </div>

        <PortalSwitcher />
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1600px] px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
