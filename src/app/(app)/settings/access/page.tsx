import { ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { isPrivileged, roleLabel } from '@/config/roles';

import { AccessEditor } from '@/components/settings/AccessEditor';
import { AddTeammate } from '@/components/settings/AddTeammate';
import { ReissueLinkButton } from '@/components/settings/ReissueLinkButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { PERMISSION_KEYS } from '@/config/permissions';
import { currentCaller } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Access & Permissions' };

/**
 * Who can see which pages.
 *
 * Role and permissions answer different questions: the role decides how far
 * someone's data reach goes (a client login sees one business, staff see all),
 * the keys decide which pages appear in their sidebar. Two admins can have
 * entirely different menus.
 */
export default async function AccessPage() {
  const caller = await currentCaller();
  if (!caller) redirect('/login');
  if (!isPrivileged(caller.role)) redirect('/dashboard');

  const people = await serviceClient()
    .from('user_profiles')
    .select('id, email, full_name, role, permissions, client_group_id')
    .order('role', { ascending: true })
    .order('email', { ascending: true });

  if (people.error) throw people.error;

  const rows = people.data ?? [];
  const staff = rows.filter((row) => row.role !== 'client');
  const clientLogins = rows.filter((row) => row.role === 'client');

  return (
    <>
      <PageHeader
        title="Access & Permissions"
        description={`Which of the ${PERMISSION_KEYS.length} pages each person sees`}
        actions={<AddTeammate callerRole={caller.role} />}
      />

      {staff.length === 0 ? (
        <EmptyState
          title="No staff accounts yet"
          description={
            'Use Add teammate above. It creates the login and hands you a ' +
            'single-use link for them to choose their own password.'
          }
          icon={<ShieldCheck size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Person</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Pages granted</th>
                  <th className="px-4 py-3 text-right font-medium">Access</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-line last:border-0 hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3">
                      <span className="block font-medium text-fg">
                        {row.full_name ?? row.email}
                      </span>
                      <span className="block text-xs text-fg-subtle">
                        {row.email}
                        {row.id === caller.id ? ' · you' : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        value={roleLabel(row.role)}
                        tone={isPrivileged(row.role) ? 'accent' : 'neutral'}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-fg-muted">
                      {row.permissions.length === 0
                        ? 'none — their sidebar is empty'
                        : row.permissions.length === PERMISSION_KEYS.length
                          ? 'everything'
                          : row.permissions.slice(0, 5).join(', ') +
                            (row.permissions.length > 5
                              ? ` +${row.permissions.length - 5}`
                              : '')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <ReissueLinkButton
                          userId={row.id}
                          name={row.full_name ?? row.email}
                        />
                        <AccessEditor
                          user={{
                            id: row.id,
                            name: row.full_name ?? row.email,
                            email: row.email,
                            role: row.role,
                            permissions: row.permissions,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {clientLogins.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-fg">Client logins</h2>
          <p className="mb-3 text-xs text-fg-subtle">
            These accounts are scoped to one business by their role, not by
            these keys. They reach the portal, never this app.
          </p>
          <div className="rounded-lg border border-line bg-surface px-4 py-3 text-xs text-fg-muted">
            {clientLogins.map((row) => row.email).join(' · ')}
          </div>
        </section>
      ) : null}

      <p className="mt-6 max-w-2xl text-xs text-fg-subtle">
        Roles control data reach; keys control the menu. Removing a key hides
        the page but does not, on its own, protect the route — route guards live
        in middleware, which is where they belong.
      </p>
    </>
  );
}
