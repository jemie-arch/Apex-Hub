import { CallSummaries } from '@/components/callcenter/CallSummaries';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { PageHeader } from '@/components/ui/PageHeader';
import { getCallSummaries } from '@/lib/call-summaries';
import { dateBounds, resolveRange } from '@/lib/range';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Call reviews' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The AI call summaries, with grading, coaching and SOP answers.
 *
 * These answer the question the role table cannot: who made each call.
 * GoHighLevel names a user on 2.4% of calls; the transcription scenario names
 * one on every row it writes.
 */
export default async function CallReviewsPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const { start, end } = dateBounds(range.from, range.to);
  const calls = await getCallSummaries({ from: start, to: end });

  return (
    <>
      <PageHeader
        eyebrow="Call centre"
        title="Call reviews"
        description={`Transcripts, grading and coaching · ${range.label}`}
        actions={<DateRangePicker />}
      />

      <CallSummaries data={calls} />
    </>
  );
}
