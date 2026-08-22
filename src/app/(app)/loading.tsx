import { PageSkeleton } from '@/components/ui/Skeleton';

/**
 * Shown the instant an internal page is navigated to.
 *
 * The shell — sidebar, portal switcher — is in the layout, so it stays put and
 * only this region swaps. That is the whole point: navigation becomes immediate
 * and visibly in progress, instead of the previous page sitting there looking
 * like the click missed.
 */
export default function Loading() {
  return <PageSkeleton />;
}
