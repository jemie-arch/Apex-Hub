import { ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { isPrivileged, roleLabel } from '@/config/roles';

import { AccessEditor } from '@/components/settings/AccessEditor';
import { AddClient } from '@/components/settings/AddClient';
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
 *
 * Staff and client logins are kept visibly apart, and are added by two separate
 * buttons. They are different things that happen to share a table: a teammate
 * needs pages, a client needs a practice, and a client login created without
 * one signs in successfully and lands on nothing.
 */
export default async function AccessPage() {
  const caller = await currentCaller();
  if (!caller) redirect('/login');
  if (!isPrivileged(caller.role)) redirect('/dashboard');

  const db = serviceClient();

  const [people, groups] = await Promise.all([
    db
      .from('user_profiles')
      .select('id, email, full_name, role, permissions, client_group_id')
      .order('role', { ascending: true })
      .order('email', { ascending: true }),
    // Internal groups are Apex's own records rather than practices anybody
    // logs in to, so they are not offered as somewhere to point a client login.
    db
      .from('client_groups')
      .select('id, name, portal_enabled, is_internal')
      .eq('is_internal', false)
      .order('name'),
  ]);

  if (people.error) throw people.error;
  if (groups.error) throw groups.error;

  const rows = people.data ?? [];
  const staff = rows.filter((row) => row.role !== 'client');
  const clientLogins = rows.filter((row) => row.role === 'client');

  const practices = (groups.data ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    portalEnabled: group.portal_enabled,
  }));

  const practiceById = new Map(practices.map((practice) => [practice.id, practice]));

  return (
    <>
      <PageHeader
        title="Access & Permissions"
        description={`Which of the ${PERMISSION_KEYS.length} pages each person sees`}
        actions={
          <div className="flex flex-wrap items-start gap-2">
            <AddTeammate callerRole={caller.role} />
            <AddClient practices={practices} />
          </div>
        }
      />

      <h2 className="mb-2 text-sm font-semibold text-fg">Team</h2>

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

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-fg">Client logins</h2>
        <p className="mb-3 max-w-2xl text-xs text-fg-subtle">
          Practices, not staff. Each one is scoped to a single business by its
          role and reaches that portal only — never this app — so permission
          keys do not apply to them.
        </p>

        {clientLogins.length === 0 ? (
          <EmptyState
            title="No client logins yet"
            description={
              'Use Add client above. It asks which practice the login belongs ' +
              'to, which is what sends them to the right portal.'
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
                    <th className="px-4 py-3 font-medium">Practice</th>
                    <th className="px-4 py-3 text-right font-medium">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {clientLogins.map((row) => {
                    const practice = row.client_group_id
                      ? practiceById.get(row.client_group_id)
                      : undefined;

                    return (
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
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {/*
                            A client with no practice is the one broken state
                            this table exists to make visible: they sign in and
                            are sent to a portal that does not resolve.
                          */}
                          {practice ? (
                            <>
                              {/* Written plainly, not through a pill: a
                                  practice name is a proper noun and humanise()
                                  would recase it. */}
                              <span className="block text-fg">
                                {practice.name}
                              </span>
                              {practice.portalEnabled ? null : (
                                <span className="block text-xs text-warning">
                                  Portal switched off — they will be turned away
                                </span>
                              )}
                            </>
                          ) : (
                            <StatusPill
                              value="No practice — cannot sign in"
                              tone="negative"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ReissueLinkButton
                            userId={row.id}
                            name={row.full_name ?? row.email}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <p className="mt-6 max-w-2xl text-xs text-fg-subtle">
        Roles control data reach; keys control the menu. Removing a key hides
        the page but does not, on its own, protect the route — route guards live
        in middleware, which is where they belong.
      </p>
    </>
  );
}
