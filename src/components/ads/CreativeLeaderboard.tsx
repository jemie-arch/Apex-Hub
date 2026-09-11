import { ArrowDown, ArrowUp, Minus, RefreshCw } from 'lucide-react';

import type { CreativeBoard, CreativeRow, Verdict } from '@/lib/creative-performance';
import { formatCount, formatMoney, formatPercent } from '@/lib/format';

const VERDICT_LABEL: Record<Verdict, string> = {
  scale: 'Scale',
  refresh: 'Refresh',
  cut: 'Cut',
  hold: 'Hold',
};

const VERDICT_TONE: Record<Verdict, string> = {
  scale: 'bg-positive-subtle text-positive',
  refresh: 'bg-warning-subtle text-warning',
  cut: 'bg-negative-subtle text-negative',
  hold: 'bg-neutral-subtle text-fg-muted',
};

/**
 * A verdict is shown as a word AND a colour, never colour alone — the board is
 * read by people who forward screenshots, and a red row loses its meaning the
 * moment it is printed, recoloured or looked at by someone colourblind.
 */
function VerdictChip({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${VERDICT_TONE[verdict]}`}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

function Trend({ trend }: { trend: number | null }) {
  if (trend === null) {
    return (
      <span className="inline-flex items-center gap-1 text-fg-subtle">
        <Minus size={13} />
        <span className="text-xs">too little</span>
      </span>
    );
  }

  // A 5% wobble either way is noise, not a direction.
  if (Math.abs(trend) < 0.05) {
    return (
      <span className="inline-flex items-center gap-1 text-fg-subtle">
        <Minus size={13} />
        <span className="numeric text-xs">flat</span>
      </span>
    );
  }

  const rising = trend > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 ${rising ? 'text-positive' : 'text-negative'}`}
    >
      {rising ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
      <span className="numeric text-xs">{formatPercent(Math.abs(trend), 0)}</span>
    </span>
  );
}

function Row({ row, currency }: { row: CreativeRow; currency: string }) {
  return (
    <tr className="border-b border-line last:border-0 align-top hover:bg-surface-hover">
      <td className="px-4 py-3">
        <div className="font-medium text-fg">{row.name}</div>
        <div className="mt-0.5 text-xs text-fg-subtle">{row.reason}</div>
      </td>
      <td className="px-4 py-3">
        <VerdictChip verdict={row.verdict} />
      </td>
      <td className="numeric px-4 py-3 text-right font-medium text-fg">
        {formatPercent(row.ctr, 2)}
      </td>
      <td className="px-4 py-3 text-right">
        <Trend trend={row.trend} />
      </td>
      <td className="numeric px-4 py-3 text-right text-fg-subtle">
        {row.cpcCents === null ? '—' : formatMoney(row.cpcCents, currency)}
      </td>
      <td className="numeric px-4 py-3 text-right text-fg-subtle">
        {formatMoney(row.spendCents, currency)}
      </td>
      <td className="numeric px-4 py-3 text-right text-fg-subtle">
        {formatCount(row.impressions)}
      </td>
      <td className="numeric px-4 py-3 text-right text-fg-subtle">
        {row.practices === 1 ? '1' : formatCount(row.practices)}
      </td>
    </tr>
  );
}

export function CreativeLeaderboard({
  board,
  currency,
}: {
  board: CreativeBoard;
  currency: string;
}) {
  if (board.rows.length === 0) return null;

  const counts = board.rows.reduce<Record<Verdict, number>>(
    (acc, row) => ({ ...acc, [row.verdict]: acc[row.verdict] + 1 }),
    { scale: 0, refresh: 0, cut: 0, hold: 0 },
  );

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">Creative leaderboard</h2>
        <p className="numeric text-xs text-fg-subtle">
          {counts.scale} to scale · {counts.refresh} to refresh · {counts.cut} to
          cut
          {board.latestDay ? ` · through ${board.latestDay}` : ''}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-xs text-fg-muted">
              <th className="px-4 py-2 font-medium">Creative</th>
              <th className="px-4 py-2 font-medium">Verdict</th>
              <th className="px-4 py-2 text-right font-medium">CTR</th>
              <th className="px-4 py-2 text-right font-medium">Trend</th>
              <th className="px-4 py-2 text-right font-medium">CPC</th>
              <th className="px-4 py-2 text-right font-medium">Spend</th>
              <th className="px-4 py-2 text-right font-medium">Impressions</th>
              <th className="px-4 py-2 text-right font-medium">Practices</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <Row key={row.name} row={row} currency={currency} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-fg-subtle">
        Ranked on click-through, judged against the fleet median of{' '}
        <span className="numeric">{formatPercent(board.medianCtr, 2)}</span>.
        Trend compares the newer half of the range against the older half.
        Creatives under 5,000 impressions are not ranked — at that volume a
        single stray click moves CTR by more than the gap between an average
        creative and a good one.
        {board.belowFloor > 0 ? (
          <>
            {' '}
            <span className="numeric">{board.belowFloor}</span> held back on that
            rule, carrying{' '}
            <span className="numeric">
              {formatMoney(board.belowFloorSpendCents, currency)}
            </span>
            .
          </>
        ) : null}
      </p>

      <p className="mt-1 flex items-start gap-1.5 text-xs text-warning">
        <RefreshCw size={13} className="mt-0.5 shrink-0" />
        {/*
          Named rather than quietly omitted. Anyone who reads this board will
          ask "but which one BOOKED patients" within a minute, and "we cannot
          tell you yet, here is exactly why" is a far better answer than a
          column they trust and should not.
        */}
        <span>
          This ranks attention, not bookings. Nothing in the pipeline writes an
          ad id onto an appointment — all 1,443 carry a null one — so no
          creative here can be traced to a booked patient. Meta&rsquo;s own lead
          figures cannot stand in either: 32 of 36 ad accounts report zero.
        </span>
      </p>
    </section>
  );
}
