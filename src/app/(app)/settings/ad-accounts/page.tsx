import { Megaphone } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isPrivileged } from '@/config/roles';

import {
  AdAccountPicker,
  type AccountOption,
} from '@/components/settings/AdAccountPicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { tenant, titleCase } from '@/config/tenant.config';
import { fetchAdAccounts, type WindsorAccount } from '@/lib/integrations/windsor';
import { formatCount, formatMoneyCompact } from '@/lib/format';
import { currentCaller } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ad accounts' };

/** How far back to look when discovering accounts and their spend. */
const PROBE_DAYS = 30;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Which Windsor ad account belongs to which practice.
 *
 * This mapping is the hinge the whole ads side turns on: with it blank the ads
 * sync has nothing to ask for, which is exactly how it spent two runs
 * reporting success while reading nothing. It is deliberately a screen rather
 * than a migration, because only somebody who knows the accounts can tell
 * "Ad Account 7" apart from "Ad Account 8".
 */
export default async function AdAccountsPage() {
  const caller = await currentCaller();
  if (!caller) redirect('/login');
  if (!isPrivileged(caller.role)) redirect('/dashboard');

  const db = serviceClient();

  const clients = await db
    .from('clients')
    .select('id, name, ad_account_id, group_id')
    .eq('is_active', true)
    .order('name');

  if (clients.error) throw clients.error;

  const rows = clients.data ?? [];

  // Windsor is asked for its accounts here rather than stored, so the list is
  // whatever is connected right now. A failure is reported on the page: the
  // mapping is still readable without it, just not editable from a list.
  let accounts: WindsorAccount[] = [];
  let accountsError: string | null = null;

  try {
    accounts = await fetchAdAccounts(
      isoDate(new Date(Date.now() - PROBE_DAYS * 86_400_000)),
      isoDate(new Date()),
    );
  } catch (error) {
    accountsError = error instanceof Error ? error.message : String(error);
  }

  const nameByAccount = new Map(
    rows
      .filter((row) => row.ad_account_id !== null)
      .map((row) => [row.ad_account_id as string, row.name]),
  );

  const options: AccountOption[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    spendCents: account.spendCents,
    takenBy: nameByAccount.get(account.id) ?? null,
  }));

  const mapped = rows.filter((row) => row.ad_account_id !== null);
  const unclaimed = options.filter((option) => option.takenBy === null);
  const totalSpend = accounts.reduce(
    (sum, account) => sum + account.spendCents,
    0,
  );

  const locationNoun = tenant.vocabulary.location;

  return (
    <>
      <PageHeader
        title="Ad accounts"
        description={`Which Windsor account belongs to which ${locationNoun.singular}`}
        actions={
          <Link
            href="/settings"
            className="text-xs text-fg-muted hover:text-fg"
          >
            Back to settings
          </Link>
        }
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Mapped"
          value={`${formatCount(mapped.length)} / ${formatCount(rows.length)}`}
          hint={`active ${locationNoun.plural}`}
        />
        <KPICard
          label="Accounts visible"
          value={formatCount(accounts.length)}
          hint={`spending in the last ${PROBE_DAYS} days`}
        />
        <KPICard
          label="Unclaimed accounts"
          value={formatCount(unclaimed.length)}
          higherIsBetter={false}
          hint="spending, but not attached to anyone"
        />
        <KPICard
          label="Spend seen"
          value={formatMoneyCompact(totalSpend)}
          hint={`across all accounts, ${PROBE_DAYS} days`}
        />
      </section>

      {accountsError !== null ? (
        <p className="mb-5 rounded-md bg-negative-subtle px-3 py-2 text-sm text-negative">
          Could not read the account list from Windsor, so the pickers below are
          empty: {accountsError}
        </p>
      ) : null}

      {unclaimed.length > 0 ? (
        <section className="mb-6 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-fg">
            Spending, but attached to nobody
          </h2>
          <p className="mt-1 text-xs text-fg-subtle">
            Money is going out through these and no {locationNoun.singular} in
            the Hub is getting credit for it. Names like
            &ldquo;Ad&nbsp;Account&nbsp;7&rdquo; need somebody who knows the
            account — a wrong guess reports one practice&apos;s spend against
            another&apos;s bookings.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {unclaimed.map((option) => (
              <span
                key={option.id}
                className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-2.5 py-1 text-xs text-fg-muted"
              >
                {option.name ?? option.id}
                <span className="numeric font-medium text-fg">
                  {formatMoneyCompact(option.spendCents)}
                </span>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title={`No active ${locationNoun.plural}`}
          description="Run the crm-clients sync to bring the sub-accounts in first."
          icon={<Megaphone size={22} />}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">
                    {titleCase(locationNoun.singular)}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    Windsor account
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-line last:border-0 hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3">
                      <span className="block font-medium text-fg">
                        {row.name}
                      </span>
                      {row.ad_account_id === null ? (
                        <span className="block text-xs text-fg-subtle">
                          no ad data will arrive until this is set
                        </span>
                      ) : (
                        <span className="numeric block text-xs text-fg-subtle">
                          {row.ad_account_id}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <AdAccountPicker
                        clientId={row.id}
                        current={row.ad_account_id}
                        options={options}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 max-w-2xl text-xs text-fg-subtle">
        An account can only be mapped to one {locationNoun.singular}: mapping it
        twice would count that spend twice and halve both practices&apos; cost
        per {tenant.vocabulary.booking.singular}. Accounts already taken are
        greyed out with the name that holds them.
      </p>
    </>
  );
}
