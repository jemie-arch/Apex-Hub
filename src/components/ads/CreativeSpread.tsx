import { GitCompareArrows } from 'lucide-react';

import type { SpreadRow } from '@/lib/creative-performance';
import { formatCount, formatPercent } from '@/lib/format';

/**
 * The same creative, run by several practices, compared like for like.
 *
 * This is the panel an ad-spy product cannot produce. Spying on a competitor
 * shows you what they are willing to try; it never shows you the result. Here
 * the creative is held constant across up to thirteen accounts and every
 * number is our own, so a gap between two practices is not the creative — it
 * is the audience, the location, the offer or the targeting.
 *
 * Which makes this the answer to "should we roll the winner out everywhere":
 * mostly no. A creative is not a thing that travels on the strength of winning
 * somewhere else, and the spread column is the evidence.
 */
function Split({
  row,
}: {
  row: SpreadRow;
}) {
  return (
    <tr className="border-b border-line last:border-0 align-top hover:bg-surface-hover">
      <td className="px-4 py-3">
        <div className="font-medium text-fg">{row.name}</div>
        <div className="mt-0.5 text-xs text-fg-subtle">
          {formatCount(row.practices)} practices ·{' '}
          {formatCount(row.impressions)} impressions
        </div>
      </td>

      <td className="px-4 py-3">
        <div className="text-xs text-fg-subtle">{row.best.clientName}</div>
        <div className="numeric font-medium text-positive">
          {formatPercent(row.best.ctr, 2)}
        </div>
      </td>

      <td className="px-4 py-3">
        <div className="text-xs text-fg-subtle">{row.worst.clientName}</div>
        <div className="numeric font-medium text-negative">
          {formatPercent(row.worst.ctr, 2)}
        </div>
      </td>

      <td className="px-4 py-3 text-right">
        <span
          className={`numeric font-medium ${row.notable ? 'text-warning' : 'text-fg-subtle'}`}
        >
          {row.spread.toFixed(2)}×
        </span>
        <div className="text-xs text-fg-subtle">
          {row.notable ? 'worth a look' : 'travels well'}
        </div>
      </td>
    </tr>
  );
}

export function CreativeSpread({ spread }: { spread: SpreadRow[] }) {
  if (spread.length === 0) return null;

  const notable = spread.filter((row) => row.notable).length;

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <GitCompareArrows size={15} />
          Same creative, different practice
        </h2>
        <p className="numeric text-xs text-fg-subtle">
          {formatCount(notable)} of {formatCount(spread.length)} differ by more
          than noise
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-xs text-fg-muted">
              <th className="px-4 py-2 font-medium">Creative</th>
              <th className="px-4 py-2 font-medium">Best practice</th>
              <th className="px-4 py-2 font-medium">Worst practice</th>
              <th className="px-4 py-2 text-right font-medium">Gap</th>
            </tr>
          </thead>
          <tbody>
            {spread.map((row) => (
              <Split key={row.name} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-fg-subtle">
        The creative is identical across these accounts, so the gap is not the
        creative — it is audience, location, offer or targeting. Practices need
        2,000 impressions against a creative to appear. A gap under 1.4× is
        reported as travelling well rather than flagged: on rates built from
        roughly this many clicks, a fifth either way is sampling luck, and
        chasing it means hunting a cause that is not there.
      </p>
    </section>
  );
}
