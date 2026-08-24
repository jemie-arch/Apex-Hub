import { LogOut } from 'lucide-react';
import { redirect } from 'next/navigation';

import { saveDisplayName, signOut } from '@/app/(app)/account/actions';
import { ThemeToggle, type Theme } from '@/components/shell/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { TimeOff } from '@/components/account/TimeOff';
import { tenant } from '@/config/tenant.config';
import { formatDateInZone, formatMoney } from '@/lib/format';
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
      'email, full_name, role, permissions, theme, client_group_id, created_at, standard_daily_hours, hourly_rate_cents',
    )
    .eq('id', caller.id)
    .maybeSingle();

  if (profile.error) throw profile.error;

  const me = profile.data;
  const theme: Theme = me?.theme === 'light' ? 'light' : 'dark';

  /*
   * Your own leave and your own payouts. RLS restricts both tables to the caller
   * unless they are an admin, and these queries are scoped to caller.id anyway —
   * belt and braces, because a pay figure shown to the wrong person is not a bug
   * you get to explain away.
   */
  const [timeOff, payouts] = await Promise.all([
    serviceClient()
      .from('time_off_requests')
      .select('id, starts_on, ends_on, kind, status, note, decision_note')
      .eq('user_id', caller.id)
      .order('starts_on', { ascending: false })
      .limit(12),
    serviceClient()
      .from('payout_lines')
      .select(
        'id, tracked_hours, leave_hours, rate_cents, amount_cents, computed_at, payout_periods(starts_on, ends_on, pay_date, state)',
      )
      .eq('user_id', caller.id)
      .order('computed_at', { ascending: false })
      .limit(8),
  ]);

  if (timeOff.error) throw timeOff.error;
  if (payouts.error) throw payouts.error;

  const dailyHours = Number(me?.standard_daily_hours ?? 8);

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

      <section className="mt-5 rounded-lg border border-line bg-surface p-6">
        <TimeOff requests={timeOff.data ?? []} dailyHours={dailyHours} />
      </section>

      <section className="mt-5 rounded-lg border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-fg">Payouts</h2>
        <p className="mt-1 text-xs text-fg-subtle">
          Fortnightly, paid on the closing Friday. Hours come from Hubstaff;
          approved paid leave is added on top.
        </p>

        {(payouts.data ?? []).length === 0 ? (
          /*
           * Two different nothings, and saying which one matters. No lines at all
           * means the Hubstaff sync has not run for you yet — not that you worked
           * no hours.
           */
          <p className="mt-4 text-xs text-fg-subtle">
            No payout has been calculated for you yet. Periods exist, but hours
            are only filled in once the Hubstaff sync has run.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="py-2 pr-3 font-medium">Period</th>
                  <th className="py-2 pr-3 font-medium">Pays</th>
                  <th className="py-2 pr-3 text-right font-medium">Tracked</th>
                  <th className="py-2 pr-3 text-right font-medium">Leave</th>
                  <th className="py-2 pr-3 text-right font-medium">Total</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(payouts.data ?? []).map((line) => {
                  const period = line.payout_periods;
                  const tracked = Number(line.tracked_hours ?? 0);
                  const leave = Number(line.leave_hours ?? 0);
                  return (
                    <tr
                      key={line.id}
                      className="border-b border-line last:border-0"
                    >
                      <td className="py-2.5 pr-3 text-fg">
                        {period ? `${period.starts_on} → ${period.ends_on}` : '—'}
                        {period ? (
                          <span className="block text-xs text-fg-subtle">
                            {period.state}
                          </span>
                        ) : null}
                      </td>
                      <td className="numeric py-2.5 pr-3 text-fg-muted">
                        {period?.pay_date ?? '—'}
                      </td>
                      <td className="numeric py-2.5 pr-3 text-right text-fg-muted">
                        {tracked.toFixed(2)}
                      </td>
                      <td className="numeric py-2.5 pr-3 text-right text-fg-muted">
                        {leave.toFixed(2)}
                      </td>
                      <td className="numeric py-2.5 pr-3 text-right font-medium text-fg">
                        {(tracked + leave).toFixed(2)}
                      </td>
                      <td className="numeric py-2.5 text-right text-fg">
                        {line.amount_cents === null ? (
                          /*
                           * Hours with no money against them. A null rate is
                           * deliberate — it means nobody has recorded what this
                           * person is paid, and showing zero would state
                           * something false about their work.
                           */
                          <span
                            className="text-fg-subtle"
                            title="No hourly rate on record, so no amount can be calculated"
                          >
                            no rate set
                          </span>
                        ) : (
                          formatMoney(line.amount_cents, 'usd')
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
