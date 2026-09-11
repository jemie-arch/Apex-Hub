import { CallCentreBoard } from '@/components/callcenter/CallCentreBoard';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { PageHeader } from '@/components/ui/PageHeader';
import { getCallCentreBoard } from '@/lib/call-centre-board';
import { dateBounds, resolveRange } from '@/lib/range';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Team board' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The HotProspector team board, rebuilt from our own call feed.
 *
 * Scoped to the range picker, unlike commission — this is a performance view
 * and looking at an arbitrary window is the point of it.
 */
export default async function CallCentreBoardPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const { start, end } = dateBounds(range.from, range.to);
  const board = await getCallCentreBoard({ from: start, to: end });

  return (
    <>
      <PageHeader
        eyebrow="Call centre"
        title="Team board"
        description={`Daily stats from our own feed · ${range.label}`}
        actions={<DateRangePicker />}
      />

      <CallCentreBoard board={board} />
    </>
  );
}
