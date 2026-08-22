import { CalendarClock, GitBranch } from 'lucide-react';

import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill, appointmentStatusTone } from '@/components/ui/StatusPill';
import { tenant } from '@/config/tenant.config';
import {
  formatCount,
  formatDateTimeInZone,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
} from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';
import type { DealStage } from '@/types/database';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Pipeline' };

/**
 * The b2b funnel: Apex selling retainers to practices.
 *
 * Deliberately a different page and different tables from appointments. A deal
 * here becomes a client_group when it is won, which is the only point the two
 * funnels touch.
 */
const STAGES: ReadonlyArray<{ key: DealStage; label: string }> = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'call_booked', label: 'Call booked' },
  { key: 'call_showed', label: 'Call showed' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];

const OPEN_STAGES: readonly DealStage[] = [
  'new',
  'contacted',
  'call_booked',
  'call_showed',
  'proposal',
];

export default async function PipelinePage() {
  const db = serviceClient();
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86_400_000);

  const [deals, upcoming, followUps] = await Promise.all([
    db
      .from('deals')
      .select('id, practice_name, stage, value_cents, currency, next_follow_up_at')
      .order('created_at', { ascending: false }),
    db
      .from('sales_calls')
      .select('id, deal_id, scheduled_at, status, showed')
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', soon.toISOString())
      .order('scheduled_at'),
    db
      .from('deals')
      .select('id, practice_name, next_follow_up_at')
      .not('next_follow_up_at', 'is', null)
      .lte('next_follow_up_at', soon.toISOString())
      .in('stage', OPEN_STAGES)
      .order('next_follow_up_at'),
  ]);

  if (deals.error) throw deals.error;
  if (upcoming.error) throw upcoming.error;
  if (followUps.error) throw followUps.error;

  const all = deals.data ?? [];
  const open = all.filter((deal) => OPEN_STAGES.includes(deal.stage));
  const won = all.filter((deal) => deal.stage === 'won');
  const decided = all.filter(
    (deal) => deal.stage === 'won' || deal.stage === 'lost',
  );

  const openValue = open.reduce((total, deal) => total + (deal.value_cents ?? 0), 0);
  const winRate = decided.length === 0 ? null : won.length / decided.length;

  const dealNameById = new Map(all.map((deal) => [deal.id, deal.practice_name]));
  const zone = tenant.defaultTimezone;

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={`${tenant.funnels.b2b} — deals, sales calls and follow-ups`}
      />

      {all.length === 0 ? (
        <EmptyState
          title="No deals yet"
          description={
            'The b2b sync (crm-deals) is not built yet, so this fills up once ' +
            'opportunities start syncing from the CRM.'
          }
          icon={<GitBranch size={22} />}
        />
      ) : (
        <>
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard label="Open deals" value={formatCount(open.length)} />
            <KPICard
              label="Open value"
              value={formatMoneyCompact(openValue)}
              hint="sum of open deal values"
            />
            <KPICard
              label="Win rate"
              value={formatPercent(winRate, 0)}
              hint={`${formatCount(won.length)} of ${formatCount(decided.length)} decided`}
            />
            <KPICard
              label="Follow-ups due"
              value={formatCount((followUps.data ?? []).length)}
              // A growing follow-up backlog is not good news.
              higherIsBetter={false}
              hint="next 7 days"
            />
          </section>

          <div className="mb-6 flex gap-4 overflow-x-auto pb-4">
            {STAGES.map((stage) => {
              const cards = all.filter((deal) => deal.stage === stage.key);
              const value = cards.reduce(
                (total, deal) => total + (deal.value_cents ?? 0),
                0,
              );

              return (
                <section
                  key={stage.key}
                  className="flex w-64 shrink-0 flex-col rounded-lg border border-line bg-surface-sunken"
                >
                  <header className="flex items-baseline justify-between gap-2 px-3 py-2.5">
                    <h2 className="text-sm font-semibold text-fg">{stage.label}</h2>
                    <span className="numeric text-xs text-fg-subtle">
                      {formatCount(cards.length)}
                    </span>
                  </header>

                  <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                    {cards.length === 0 ? (
                      <p className="px-1 py-3 text-xs text-fg-subtle">Empty</p>
                    ) : (
                      cards.map((deal) => (
                        <article
                          key={deal.id}
                          className="rounded-md border border-line bg-surface p-3 shadow-sm"
                        >
                          <p className="truncate text-sm font-medium text-fg">
                            {deal.practice_name}
                          </p>
                          <p className="numeric mt-1 text-xs text-fg-subtle">
                            {deal.value_cents === null
                              ? 'no value set'
                              : formatMoney(deal.value_cents, deal.currency)}
                          </p>
                        </article>
                      ))
                    )}
                  </div>

                  {value > 0 ? (
                    <footer className="numeric border-t border-line px-3 py-2 text-xs text-fg-subtle">
                      {formatMoneyCompact(value)}
                    </footer>
                  ) : null}
                </section>
              );
            })}
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <h2 className="flex items-center gap-1.5 border-b border-line px-4 py-3 text-sm font-semibold text-fg">
            <CalendarClock size={15} /> Sales calls, next 7 days
          </h2>
          {(upcoming.data ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">
              Nothing booked.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {(upcoming.data ?? []).map((call) => (
                  <tr key={call.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-fg">
                      {dealNameById.get(call.deal_id) ?? 'Unknown'}
                    </td>
                    <td className="numeric px-4 py-2.5 text-xs text-fg-muted">
                      {formatDateTimeInZone(call.scheduled_at, zone, 'd MMM HH:mm')}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <StatusPill
                        value={call.status}
                        tone={appointmentStatusTone(call.status)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-fg">
            Follow-ups due
          </h2>
          {(followUps.data ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">
              Nothing due in the next 7 days.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {(followUps.data ?? []).map((deal) => {
                  const overdue =
                    deal.next_follow_up_at !== null &&
                    new Date(deal.next_follow_up_at) < now;

                  return (
                    <tr key={deal.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 text-fg">{deal.practice_name}</td>
                      <td
                        className={`numeric px-4 py-2.5 text-right text-xs ${
                          overdue ? 'text-negative' : 'text-fg-muted'
                        }`}
                      >
                        {formatDateTimeInZone(
                          deal.next_follow_up_at,
                          zone,
                          'd MMM HH:mm',
                        )}
                        {overdue ? ' · overdue' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
