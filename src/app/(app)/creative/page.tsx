import { Sparkles } from 'lucide-react';

import { CreativeLeaderboard } from '@/components/ads/CreativeLeaderboard';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { tenant } from '@/config/tenant.config';
import { getCreativeBoard } from '@/lib/creative-performance';
import { formatPercent } from '@/lib/format';
import { dateBounds, resolveRange } from '@/lib/range';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Creative performance' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Which creatives to scale, refresh or cut.
 *
 * Media buying asked for an ad-spy tool — the kind that ranks other people's
 * ads out of the public ad library. This points the same idea at our own 565,
 * which is the more useful direction: a competitor's creative tells you what
 * they are willing to try, ours tells you what actually spends well in dental.
 *
 * Grouped by creative NAME rather than ad id, because the same creative is run
 * across several practices and relaunched under fresh ids. One concept running
 * at twelve practices is one row with twelve practices' worth of evidence
 * behind it, which is the entire reason this is worth more than reading each
 * ad account separately.
 *
 * The reasoning behind what it is allowed to rank on — and the booking column
 * that deliberately does not exist — is in src/lib/creative-performance.ts.
 */
export default async function CreativePage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']) ?? 'last_30',
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const { start, end } = dateBounds(range.from, range.to);
  const board = await getCreativeBoard({ from: start, to: end });

  const toScale = board.rows.filter((row) => row.verdict === 'scale').length;

  return (
    <>
      <PageHeader
        eyebrow="Media buying"
        title="Creative performance"
        description={
          board.medianCtr === null ? (
            `Which creatives to scale, refresh or cut · ${range.label}`
          ) : (
            <>
              Fleet median click-through{' '}
              <span className="numeric text-accent">
                {formatPercent(board.medianCtr, 2)}
              </span>{' '}
              · {range.label}
            </>
          )
        }
        pill={
          toScale > 0
            ? { label: `${toScale} to scale`, tone: 'positive' }
            : undefined
        }
        actions={<DateRangePicker />}
      />

      {board.rows.length === 0 ? (
        <EmptyState
          title="No creative cleared the floor"
          description={
            'Ranking needs 5,000 impressions against a creative in the range. ' +
            'Widen the dates, or check that the Windsor ad sync has run.'
          }
          icon={<Sparkles size={22} />}
        />
      ) : (
        <CreativeLeaderboard board={board} currency={tenant.defaultCurrency} />
      )}
    </>
  );
}
