import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { isPrivileged } from '@/config/roles';

import { PortalSwitcher } from '@/components/shell/PortalSwitcher';
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
  const isAdmin = isPrivileged(profile.data?.role);

  /*
   * A narrower gate than isAdmin, for the handful of pages that act on live
   * systems rather than report on them.
   *
   * isPrivileged covers both 'admin' and 'super_admin', which is right for
   * reading anything. Provisioning creates GoHighLevel sub-accounts and writes
   * their custom values, and "only the owner sees this" was the requirement —
   * so it is gated on super_admin specifically. Role rather than email: the
   * same outcome today, without a person's address baked into navigation.
   */
  const isSuperAdmin = profile.data?.role === 'super_admin';

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar
        permissions={permissions}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        theme={theme}
      />
      <main className="flex-1 overflow-y-auto">
        {/*
          The switcher sits above the page rather than inside the sidebar: it
          moves you between portals, which is a different kind of action from
          moving between pages of one portal.
        */}
        <div className="mx-auto flex max-w-[1600px] justify-end px-8 pt-6">
          <PortalSwitcher />
        </div>
        <div className="mx-auto max-w-[1600px] px-8 pb-8 pt-4">{children}</div>
      </main>
    </div>
  );
}
