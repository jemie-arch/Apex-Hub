import { cn } from '@/lib/cn';

/**
 * Placeholder shapes shown while a page's data is in flight.
 *
 * Worth being deliberate about why these exist. The app and its database sit in
 * Virginia and the people using it are in Asia, so a round trip is a few hundred
 * milliseconds before any query runs. That cannot be removed from this side of
 * the wire — but waiting with no feedback can. Without a loading boundary Next
 * holds the previous page on screen until the next one is ready, so a click
 * looks like it did nothing and people click again.
 *
 * These mirror the shape of the real page rather than showing a spinner, so the
 * layout does not jump when content replaces them.
 *
 * `animate-pulse` is dropped under prefers-reduced-motion by Tailwind's own
 * motion-safe handling; the shapes still convey that something is coming.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'motion-safe:animate-pulse rounded-md bg-surface-sunken',
        className,
      )}
      aria-hidden
    />
  );
}

/** A page header with a title and a subtitle beneath it. */
export function SkeletonHeader() {
  return (
    <div className="mb-6">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-72" />
    </div>
  );
}

/** A row of stat cards. Four is what most pages open with. */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="rounded-lg border border-line bg-surface p-4"
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-24" />
          <Skeleton className="mt-2 h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

/** A table with a header strip and evenly spaced rows. */
export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  return (
    <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <Skeleton className="h-3 w-32" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-0"
        >
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

/**
 * The default whole-page placeholder: header, cards, table.
 *
 * Close enough to every page in the app that one component covers all of them,
 * and near enough in height that the real content does not shove the page
 * around when it lands.
 */
export function PageSkeleton({
  cards = 4,
  rows = 8,
}: {
  cards?: number;
  rows?: number;
}) {
  return (
    <div role="status" aria-label="Loading">
      <SkeletonHeader />
      {cards > 0 ? <SkeletonCards count={cards} /> : null}
      <SkeletonTable rows={rows} />
    </div>
  );
}
