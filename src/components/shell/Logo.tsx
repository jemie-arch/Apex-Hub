import Image from 'next/image';

import { tenant } from '@/config/tenant.config';
import { cn } from '@/lib/cn';

/**
 * The Apex wordmark.
 *
 * Served from /public rather than hot-linked from the GoHighLevel CDN: the
 * header of every page should not depend on somebody else's uptime.
 *
 * The file supplied carried a wide transparent margin — the mark occupied about
 * half the canvas — so setting a height made it render at half the size asked
 * for. This is the same artwork with the empty alpha trimmed off, which is why
 * the caller can now say "34px tall" and get 34 pixels of logo.
 *
 * It is a white monochrome mark, invisible on a light background, so
 * `logo-mark` in globals.css inverts it under the light theme. Safe only because
 * it is monochrome; inverting a colour logo would produce something
 * unrecognisable.
 */

/** The trimmed artwork's own proportions, so no caller has to do this sum. */
const RATIO = 1759 / 629;

export function Logo({
  className,
  height = 34,
  priority = false,
}: {
  className?: string;
  /** Rendered height in pixels. Width follows from the artwork's ratio. */
  height?: number;
  priority?: boolean;
}) {
  const width = Math.round(height * RATIO);

  return (
    <Image
      src="/apex-logo.png"
      alt={tenant.company.name}
      width={width}
      height={height}
      priority={priority}
      className={cn('logo-mark object-contain', className)}
    />
  );
}
