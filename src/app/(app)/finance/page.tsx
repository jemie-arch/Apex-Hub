import { Wallet } from 'lucide-react';
import Link from 'next/link';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import {
  formatCount,
  formatMoney,
  formatMoneyCompact,
  humanise,
} from '@/lib/format';
import { dateBounds, resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Finance' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Revenue and cost lines.
 *
 * Retainers are held on the client record, not here — this is the ledger of
 * what actually moved, which is a different thing from what was contracted.
 */
export default async function FinancePage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']) ?? 'this_month',
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();
  const { start, end } = dateBounds(range.from, range.to);

  const [entries, groups, retainers] = await Promise.all([
    db
      .from('finance_entries')
      .select(
        'id, client_group_id, kind, category, amount_cents, currency, occurred_on, memo, source',
      )
      .gte('occurred_on', start)
      .lte('occurred_on', end)
      .order('occurred_on', { ascending: false })
      .limit(300),
    db.from('client_groups').select('id, name'),
    db
      .from('client_groups')
      .select('retainer_cents, currency')
      .eq('status', 'active'),
  ]);

  if (entries.error) throw entries.error;
  if (groups.error) throw groups.error;
  if (retainers.error) throw retainers.error;

  const groupById = new Map((groups.data ?? []).map((r) => [r.id, r.name]));
  const rows = entries.data ?? [];

  let revenueCents = 0;
  let costCents = 0;
  for (const row of rows) {
    if (row.kind === 'revenue') revenueCents += row.amount_cents;
    else costCents += row.amount_cents;
  }

  const contracted = (retainers.data ?? []).reduce(
    (total, row) => total + row.retainer_cents,
    0,
  );

  const client = tenant.vocabulary.client;

  return (
    <>
      <PageHeader
        title="Finance"
        description={`Revenue and cost lines · ${range.label}`}
        actions={<DateRangePicker />}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard label="Revenue recorded" value={formatMoneyCompact(revenueCents)} />
        <KPICard
          label="Costs recorded"
          value={formatMoneyCompact(costCents)}
          higherIsBetter={false}
        />
        <KPICard
          label="Net"
          value={formatMoneyCompact(revenueCents - costCents)}
          hint="recorded lines only"
        />
        <KPICard
          label="Contracted monthly"
          value={formatMoneyCompact(contracted)}
          hint={`retainers of active ${client.plural}`}
        />
      </section>

      {rows.length === 0 ? (
        <EmptyState
          title="No entries in this period"
          description={
            'Nothing has been recorded here yet. Contracted retainers are shown ' +
            `above from the ${client.singular} records — this ledger tracks what ` +
            'actually moved, which is a different question.'
          }
          icon={<Wallet size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Kind</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">
                    {titleCase(client.singular)}
                  </th>
                  <th className="px-4 py-3 font-medium">Memo</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-line last:border-0 hover:bg-surface-hover"
                  >
                    <td className="numeric px-4 py-3 text-fg-muted">
                      {row.occurred_on}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        value={row.kind}
                        tone={row.kind === 'revenue' ? 'positive' : 'warning'}
                      />
                    </td>
                    <td className="px-4 py-3 text-fg">{humanise(row.category)}</td>
                    <td className="px-4 py-3 text-fg-muted">
                      {row.client_group_id ? (
                        <Link
                          href={`/clients/${row.client_group_id}`}
                          className="hover:text-accent"
                        >
                          {groupById.get(row.client_group_id) ?? 'Unknown'}
                        </Link>
                      ) : (
                        <span className="text-fg-subtle">company-wide</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-fg-subtle">
                      {row.memo ?? '—'}
                      {row.source !== 'manual' ? ` · ${row.source}` : ''}
                    </td>
                    <td
                      className={
                        row.kind === 'revenue'
                          ? 'numeric px-4 py-3 text-right text-positive'
                          : 'numeric px-4 py-3 text-right text-fg-muted'
                      }
                    >
                      {formatMoney(row.amount_cents, row.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows.length > 0 ? (
        <p className="mt-4 text-xs text-fg-subtle">
          {formatCount(rows.length)} line(s). Net counts only what is recorded
          here — it is not a P&amp;L.
        </p>
      ) : null}
    </>
  );
}
