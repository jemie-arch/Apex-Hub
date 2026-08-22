import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Sidebar } from '@/components/shell/Sidebar';
import type { Theme } from '@/components/shell/ThemeToggle';
import { currentCaller } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

/**
 * The internal app shell.
 *
 * Route access is decided in middleware — nothing here grants or blocks a
 * page. This only reads the caller's permission keys so the sidebar shows the
 * items they are allowed, and their theme so the toggle starts in the right
 * position.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const caller = await currentCaller();

  // Middleware should have redirected already; this is belt and braces for a
  // session that expires between the middleware check and the render.
  if (!caller) redirect('/login');

  const profile = await serviceClient()
    .from('user_profiles')
    .select('permissions, theme, role')
    .eq('id', caller.id)
    .maybeSingle();

  const permissions = profile.data?.permissions ?? [];
  const theme: Theme = profile.data?.theme === 'light' ? 'light' : 'dark';

  /*
   * Admins see every menu item, rather than only the keys stored on their row.
   *
   * Middleware already lets an admin reach any route, so the stored list was
   * only ever deciding what they could *find*. That made adding a page a data
   * migration: /billing shipped, worked when typed into the address bar, and was
   * invisible in the menu because no existing row carried the new key. A page
   * nobody can find is indistinguishable from a page that was never deployed.
   */
  const isAdmin = profile.data?.role === 'admin';

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar permissions={permissions} isAdmin={isAdmin} theme={theme} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1600px] px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
