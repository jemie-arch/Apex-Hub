import { PageSkeleton } from '@/components/ui/Skeleton';

/**
 * A client waiting on their own results page. Fewer rows than the internal
 * pages, because their tables are shorter.
 */
export default function Loading() {
  return <PageSkeleton cards={4} rows={5} />;
}
