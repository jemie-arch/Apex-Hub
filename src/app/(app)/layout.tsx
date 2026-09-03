import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { isPrivileged } from '@/config/roles';

import { NotificationBell, type InboxItem } from '@/components/shell/NotificationBell';
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

  const db = serviceClient();

  const [profile, inbox] = await Promise.all([
    db
      .from('user_profiles')
      .select('permissions, theme, role')
      .eq('id', caller.id)
      .maybeSingle(),
    /*
     * The bell's contents, read once per navigation rather than polled.
     *
     * Twenty is a panel's worth. The unread badge counts only what is in this
     * slice, which is honest for any realistic backlog and wrong only for
     * somebody who has ignored the bell twenty times — at which point the exact
     * number has stopped being information anyway.
     */
    db
      .from('notifications')
      .select('id, title, body, href, read_at, created_at')
      .eq('user_id', caller.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

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

  const notifications: InboxItem[] = (inbox.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    href: row.href,
    createdAt: row.created_at,
    read: row.read_at !== null,
  }));

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
        {/*
          Fluid rather than capped at 1600px.

          The cap left dead space either side on a wide monitor while the tables
          it was protecting — Clients has nine columns, the ledger more — were
          the very things that needed the room. A max-width earns its place on a
          page of prose, where a long measure hurts reading; it costs on a page
          of data, where the alternative to width is a horizontal scrollbar.

          Padding steps up with the viewport instead of sitting at a fixed 2rem,
          which on a phone spent an eighth of the screen on margins.
        */}
        <div className="flex items-center justify-end gap-3 px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6">
          <NotificationBell items={notifications} />
          <PortalSwitcher />
        </div>
        <div className="px-4 pb-8 pt-4 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
