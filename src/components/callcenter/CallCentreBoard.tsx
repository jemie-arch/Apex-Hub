import type { CallCentreBoard as Board, CallCentreRow } from '@/lib/call-centre-board';
import { formatCount, formatDuration, formatPercent } from '@/lib/format';

/**
 * The HotProspector team board, rebuilt from our own call feed.
 *
 * Deliberately does not show ANSWERS, AR or CR. They depend on a definition of
 * "answered" that our data does not yet reproduce, and a column filled with the
 * closest guess would be indistinguishable from a correct one — which is the
 * worst property a number on a dashboard can have.
 */
function Row({ row, emphasis }: { row: CallCentreRow; emphasis?: boolean }) {
  return (
    <tr
      className={
        emphasis
          ? 'border-b border-line bg-surface font-medium text-fg'
          : 'border-b border-line last:border-0 hover:bg-surface-hover'
      }
    >
      <td className="px-4 py-3 font-medium text-fg">{row.displayName}</td>
      <td className="numeric px-4 py-3 text-right">{formatCount(row.outbound)}</td>
      <td className="numeric px-4 py-3 text-right text-fg-subtle">
        {formatCount(row.inbound)}
      </td>
      <td className="numeric px-4 py-3 text-right text-fg-subtle">
        {formatCount(row.hangUps)}
      </td>
      <td className="numeric px-4 py-3 text-right text-fg-subtle">
        {formatDuration(row.aodSeconds)}
      </td>
      <td className="numeric px-4 py-3 text-right text-fg-subtle">
        {formatDuration(row.aidSeconds)}
      </td>
      <td className="numeric px-4 py-3 text-right">
        {formatCount(Math.round(row.talkSeconds / 60))}
      </td>
      <td className="numeric px-4 py-3 text-right text-fg-subtle">
        {formatDuration(row.avgSeconds)}
      </td>
      <td className="numeric px-4 py-3 text-right">{formatCount(row.convos)}</td>
      <td className="numeric px-4 py-3 text-right">{formatCount(row.appts)}</td>
      <td className="numeric px-4 py-3 text-right">
        {formatPercent(row.abr, 1)}
      </td>
    </tr>
  );
}

export function CallCentreBoard({ board }: { board: Board }) {
  if (board.agents.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium text-fg">Call centre board</h2>
        {board.latestDay ? (
          <p className="numeric text-xs text-fg-subtle">
            feed through {board.latestDay}
          </p>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-xs text-fg-muted">
              <th className="px-4 py-2 font-medium">Member</th>
              <th className="px-4 py-2 text-right font-medium">Outbound</th>
              <th className="px-4 py-2 text-right font-medium">Inbound</th>
              <th className="px-4 py-2 text-right font-medium">Hang ups</th>
              <th className="px-4 py-2 text-right font-medium">AOD</th>
              <th className="px-4 py-2 text-right font-medium">AID</th>
              <th className="px-4 py-2 text-right font-medium">Talk min</th>
              <th className="px-4 py-2 text-right font-medium">Avg</th>
              <th className="px-4 py-2 text-right font-medium">Convos</th>
              <th className="px-4 py-2 text-right font-medium">Appts</th>
              <th className="px-4 py-2 text-right font-medium">ABR</th>
            </tr>
          </thead>
          <tbody>
            {board.team ? <Row row={board.team} emphasis /> : null}
            {board.agents.map((row) => (
              <Row key={row.agentId || row.displayName} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-fg-subtle">
        Computed from the call feed, not copied from HotProspector — the same
        rows agent pay is counted from, so the two cannot disagree. A
        conversation is 90 seconds or more. ABR is appointments over
        conversations, which matches the original.
      </p>

      <p className="mt-1 text-xs text-warning">
        {/*
          Named rather than silently omitted. Somebody comparing this against
          HotProspector will notice five missing columns within seconds, and
          "we know, here is why" is a far better answer than their working it
          out themselves and distrusting the rest.
        */}
        Not shown: <strong>Answers, AR and CR</strong> — our feed does not yet
        reproduce HotProspector&rsquo;s definition of an answered call, and a
        guessed column would look exactly like a correct one.{' '}
        <strong>ANS/HR</strong> needs hours worked, which arrives with the
        Hubstaff sync. <strong>SMS</strong> and <strong>Prospects</strong> are
        not in the call feed at all.
      </p>
    </section>
  );
}
