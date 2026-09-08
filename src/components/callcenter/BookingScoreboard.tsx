/**
 * Per-agent bookings, from the sheet that decides pay.
 *
 * The table above this one ranks people by call activity and has always been
 * empty: `calls` names a person on 0 of 7,139 rows, because inbound forwards
 * off-platform and GoHighLevel stamps a user on 2.4% of them. This is the same
 * question answered from a source that does name people — BOOKING SHEET, the
 * tab DAILY BONUS TALLY counts and therefore the tab pay already runs on.
 *
 * It states what it cannot compute. The daily bonus needs the day each booking
 * was made, and every imported row has come through without one, so that
 * section says so instead of rendering zeros. A zero bonus and an
 * uncomputable bonus are different facts and only one of them is somebody
 * earning nothing.
 */
import { AlertTriangle, ClipboardList } from 'lucide-react';

import { EmptyState } from '@/components/ui/EmptyState';
import type { AgentDay } from '@/lib/agent-pay';
import type { AgentTotals, Scoreboard } from '@/lib/agent-scoreboard';
import { formatCount, formatMoney } from '@/lib/format';

function Row({ agent }: { agent: AgentTotals }) {
  return (
    <tr className="border-b border-line last:border-0 hover:bg-surface-hover">
      <td className="px-4 py-3 font-medium text-fg">{agent.agent}</td>
      <td className="numeric px-4 py-3 text-right">
        {formatCount(agent.bookings)}
      </td>
      <td className="numeric px-4 py-3 text-right">
        {agent.invalid === 0 ? (
          <span className="text-fg-subtle">0</span>
        ) : (
          <span className="text-negative">{formatCount(agent.invalid)}</span>
        )}
      </td>
      <td className="numeric px-4 py-3 text-right">
        {formatCount(agent.countable)}
      </td>
      <td className="numeric px-4 py-3 text-right">
        {formatMoney(agent.unitCommissionCents)}
      </td>
    </tr>
  );
}

export function BookingScoreboard({ board }: { board: Scoreboard }) {
  const { totals, days, audit, scheme } = board;

  /* Days grouped by agent, so a person's paying days read as a run rather
     than as scattered rows. Only the days that reached a tier are shown:
     a day below the threshold pays nothing and listing it as £0 buries the
     ones that did. */
  const paying = days.filter((day) => day.bonusCents > 0);
  const bonusByAgent = new Map<string, { days: AgentDay[]; cents: number }>();
  for (const day of paying) {
    const held = bonusByAgent.get(day.agent) ?? { days: [], cents: 0 };
    held.days.push(day);
    held.cents += day.bonusCents;
    bonusByAgent.set(day.agent, held);
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">Bookings by agent</h2>
          <p className="mt-0.5 text-xs text-fg-subtle">
            From BOOKING SHEET on the Call Center Agent Dashboard — the tab the
            live pay calculation reads.
          </p>
        </div>
        <span className="numeric text-[11px] text-fg-subtle">
          {formatCount(audit.bookingRows)} row(s) imported
        </span>
      </div>

      {totals.length === 0 ? (
        <EmptyState
          title="No bookings imported yet"
          description={
            'BOOKING SHEET has not been read. Run booking-sheet from Settings, ' +
            'then this fills from the same rows the dashboard counts.'
          }
          icon={<ClipboardList size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 text-right font-medium">Bookings</th>
                  <th className="px-4 py-3 text-right font-medium">Invalid</th>
                  {/* Named for the arithmetic, because the penalty is a count
                      of bookings and not a deduction in money. */}
                  <th className="px-4 py-3 text-right font-medium">
                    Countable
                    {scheme ? ` (−${scheme.bookingsLostPerInvalid} each)` : ''}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    At unit rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {totals.map((agent) => (
                  <Row key={agent.agent} agent={agent} />
                ))}
              </tbody>
            </table>
          </div>

          {/*
            Stated on the table rather than in a tooltip. "At unit rate" is not
            what anybody is paid — the quota rate and the daily bonus both sit
            on top of it — and a money column on a call-centre page will be
            read as a wage unless it says otherwise.
          */}
          <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-fg-subtle">
            <span className="font-medium text-fg-muted">Not a wage.</span> At
            unit rate is countable bookings ×{' '}
            {scheme ? formatMoney(scheme.unitAmount) : 'the unit rate'}, before
            the quota rate and before the daily bonus. It exists to reconcile
            against the dashboard, not to pay from.
            {audit.withoutAgent > 0 ? (
              <>
                {' '}
                <span className="text-negative">
                  {formatCount(audit.withoutAgent)} of{' '}
                  {formatCount(audit.bookingRows)} rows name no agent
                </span>{' '}
                and count toward nobody — here or in the sheet&apos;s own
                totals.
              </>
            ) : null}
          </p>
        </div>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-fg">Daily bonus</h3>
        <p className="mt-0.5 text-xs text-fg-subtle">
          Earned per person per day. The penalty applies before the tier is
          read, so six bookings with one invalid is four countable and pays
          nothing.
        </p>

        {audit.dailyBonusBlockedBecause !== null ? (
          /*
            An explanation, not an empty state. The distinction matters: an
            empty table here would be read as "nobody earned a bonus", which is
            a statement about four people's pay that the data does not support.
          */
          <div className="mt-3 flex gap-3 rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3">
            <AlertTriangle
              size={16}
              className="mt-0.5 shrink-0 text-warning"
              aria-hidden
            />
            <div className="text-xs leading-relaxed text-fg-muted">
              <p className="font-medium text-fg">
                Cannot be calculated yet — this is not a zero.
              </p>
              <p className="mt-1">{audit.dailyBonusBlockedBecause}</p>
              <p className="mt-1.5 numeric text-fg-subtle">
                {formatCount(audit.withDate)} of{' '}
                {formatCount(audit.bookingRows)} bookings carry a date ·{' '}
                {formatCount(audit.invalidReports)} invalid report(s)
              </p>
            </div>
          </div>
        ) : bonusByAgent.size === 0 ? (
          <p className="mt-3 rounded-lg border border-line bg-surface px-4 py-3 text-xs text-fg-muted">
            No day reached {scheme?.tier1Threshold ?? 5} countable bookings in
            this period, so no bonus was earned. The dates are present, so this
            one is a real zero.
          </p>
        ) : (
          <div className="panel mt-3 overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Days that paid
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Bonus</th>
                </tr>
              </thead>
              <tbody>
                {[...bonusByAgent.entries()]
                  .sort((a, b) => b[1].cents - a[1].cents)
                  .map(([agent, held]) => (
                    <tr
                      key={agent}
                      className="border-b border-line last:border-0"
                    >
                      <td className="px-4 py-3 font-medium text-fg">{agent}</td>
                      <td className="numeric px-4 py-3 text-right">
                        {formatCount(held.days.length)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-positive">
                        {formatMoney(held.cents)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
