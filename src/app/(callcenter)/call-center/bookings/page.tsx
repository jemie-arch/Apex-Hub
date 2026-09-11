import { BookingScoreboard } from '@/components/callcenter/BookingScoreboard';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { PageHeader } from '@/components/ui/PageHeader';
import { getScoreboard } from '@/lib/agent-scoreboard';
import { dateBounds, resolveRange } from '@/lib/range';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Bookings' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Who is booking, from BOOKING SHEET.
 *
 * Separate from Role efficiency because the two come from sources with very
 * different coverage: calls name a person on almost none of their rows, while
 * BOOKING SHEET names one on 318 of 383. Folding them into one table presented
 * an answerable question as unanswered.
 */
export default async function BookingsPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  /*
   * Calendar dates, because BOOKING SHEET's own column is a date and not an
   * instant. Comparing a date column against a timestamp boundary is how a
   * whole day drops off the end of a window.
   */
  const { start, end } = dateBounds(range.from, range.to);
  const board = await getScoreboard({ from: start, to: end });

  return (
    <>
      <PageHeader
        eyebrow="Call centre"
        title="Bookings"
        description={`Who is booking · ${range.label}`}
        actions={<DateRangePicker />}
      />

      <BookingScoreboard board={board} />
    </>
  );
}
