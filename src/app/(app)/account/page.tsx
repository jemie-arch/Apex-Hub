import { LogOut } from 'lucide-react';
import { redirect } from 'next/navigation';

import { saveDisplayName, signOut } from '@/app/(app)/account/actions';
import { ThemeToggle, type Theme } from '@/components/shell/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { tenant } from '@/config/tenant.config';
import { formatDateInZone } from '@/lib/format';
import { currentCaller } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'My Account' };

/** Your own profile: name, theme, what you can see, and the way out. */
export default async function AccountPage() {
  const caller = await currentCaller();
  if (!caller) redirect('/login');

  const profile = await serviceClient()
    .from('user_profiles')
    .select(
      'email, full_name, role, permissions, theme, client_group_id, created_at',
    )
    .eq('id', caller.id)
    .maybeSingle();

  if (profile.error) throw profile.error;

  const me = profile.data;
  const theme: Theme = me?.theme === 'light' ? 'light' : 'dark';

  return (
    <>
      <PageHeader
        title="My Account"
        description={me?.email ?? caller.email ?? 'Signed in'}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="rounded-lg border border-line bg-surface p-6 lg:col-span-2">
          <h2 className="text-sm font-semibold text-fg">Profile</h2>
          <p className="mt-1 text-xs text-fg-subtle">
            Your name is what appears on the leaderboard and against calls and
            {' '}{tenant.vocabulary.booking.plural} you own.
          </p>

          <form action={saveDisplayName} className="mt-4 flex flex-wrap gap-2">
            <input
              type="text"
              name="full_name"
              defaultValue={me?.full_name ?? ''}
              placeholder="Full name"
              className="h-10 min-w-[16rem] flex-1 rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle"
            />
            <Button type="submit" variant="primary">
              Save
            </Button>
          </form>

          <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">
                Email
              </dt>
              <dd className="mt-1 truncate text-sm text-fg">
                {me?.email ?? caller.email ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">
                Role
              </dt>
              <dd className="mt-1">
                <StatusPill
                  value={me?.role ?? caller.role}
                  tone={
                    (me?.role ?? caller.role) === 'admin' ? 'accent' : 'neutral'
                  }
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">
                With us since
              </dt>
              <dd className="numeric mt-1 text-sm text-fg">
                {me?.created_at
                  ? formatDateInZone(me.created_at, tenant.defaultTimezone)
                  : '—'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-line bg-surface p-6">
          <h2 className="text-sm font-semibold text-fg">Appearance</h2>
          <p className="mt-1 text-xs text-fg-subtle">
            Follows you to any device you sign in on.
          </p>
          <div className="mt-4">
            <ThemeToggle initial={theme} />
          </div>

          <hr className="my-6 border-line" />

          <h2 className="text-sm font-semibold text-fg">Session</h2>
          <p className="mt-1 text-xs text-fg-subtle">
            Signing out clears the session on this device.
          </p>
          <form action={signOut} className="mt-4">
            <Button type="submit" icon={<LogOut size={14} />}>
              Sign out
            </Button>
          </form>
        </section>
      </div>

      {/*
        The "Pages you can see" panel used to sit here, listing all 25 keys with
        the ones you lack struck through. Removed: it told somebody what they
        were not trusted with, which is a conversation for a manager rather than
        a line item on their own profile, and the struck-through half of the list
        was the only part that carried any information.

        Nothing about access changed — the sidebar already shows exactly the
        pages a person holds, which is the same answer arrived at by walking the
        menu instead of reading a denial.
      */}
    </>
  );
}
