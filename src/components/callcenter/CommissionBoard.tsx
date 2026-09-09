import type { AgentCommission } from '@/lib/agent-commission';
import { cn } from '@/lib/cn';
import { formatCount, formatMoney } from '@/lib/format';

/**
 * What each agent has earned in commission over the rolling thirty days.
 *
 * Mirrors the pay dashboard rather than improving on it — see
 * lib/agent-commission for why that is deliberate.
 */
export function CommissionBoard({ agents }: { agents: AgentCommission[] }) {
  if (agents.length === 0) return null;

  const total = agents.reduce((sum, agent) => sum + agent.commissionCents, 0);
  const booked = agents.reduce((sum, agent) => sum + agent.booked30d, 0);
  /*
   * Agents with no Hub login are the normal case for the call centre, but they
   * are also the ones the pay dashboard cannot list — its agent column is a
   * FILTER over a two-name list. Counted so the note below can be specific.
   */
  const unlisted = agents.filter((agent) => agent.userId === null).length;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium text-fg">Commission, last 30 days</h2>
        <p className="numeric text-xs text-fg-subtle">
          {formatCount(booked)} booked · {formatMoney(total)}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-xs text-fg-muted">
              <th className="px-4 py-2 font-medium">Agent</th>
              <th className="px-4 py-2 text-right font-medium">Calls</th>
              <th className="px-4 py-2 text-right font-medium">Booked</th>
              <th className="px-4 py-2 text-right font-medium">Rate</th>
              <th className="px-4 py-2 text-right font-medium">Commission</th>
              <th className="px-4 py-2 text-right font-medium">To next rate</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr
                key={agent.agentId}
                className="border-b border-line last:border-0 hover:bg-surface-hover"
              >
                <td className="px-4 py-3 font-medium text-fg">
                  {agent.displayName}
                </td>
                <td className="numeric px-4 py-3 text-right text-fg-subtle">
                  {formatCount(agent.calls30d)}
                </td>
                <td className="numeric px-4 py-3 text-right">
                  {formatCount(agent.booked30d)}
                </td>
                <td
                  className={cn(
                    'numeric px-4 py-3 text-right',
                    agent.band === 'base' ? 'text-fg-subtle' : 'text-fg',
                  )}
                >
                  {formatMoney(agent.rateCents)}
                </td>
                <td className="numeric px-4 py-3 text-right font-medium text-fg">
                  {formatMoney(agent.commissionCents)}
                </td>
                <td className="numeric px-4 py-3 text-right text-fg-subtle">
                  {/*
                    On a cliff rate this is the most actionable number on the
                    row. An agent two bookings short of the next band is two
                    bookings short of every booking they have already made being
                    worth more, which is worth telling them.
                  */}
                  {agent.bookingsToNextBand === null
                    ? '—'
                    : formatCount(agent.bookingsToNextBand)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-fg-subtle">
        Counted the way the pay dashboard counts: rows on the RAW DATA tab whose
        disposition contains &ldquo;Booked&rdquo;, over the rolling thirty days.
        The rate is a cliff, not a tier — it applies to every booking, so
        crossing 96 is worth far more than one booking.
      </p>

      {unlisted > 0 ? (
        <p className="mt-1 text-xs text-warning">
          {unlisted === 1 ? '1 agent has' : `${unlisted} agents have`} no Hub
          profile. That is normal for the call centre, but the pay dashboard
          lists only the agents named in its INPUT VALUES tab — anyone here who
          is missing from that list is not being paid the commission shown.
        </p>
      ) : null}
    </section>
  );
}
