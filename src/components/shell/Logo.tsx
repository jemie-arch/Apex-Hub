import Image from 'next/image';

import { tenant } from '@/config/tenant.config';
import { cn } from '@/lib/cn';

/**
 * The Apex wordmark.
 *
 * The asset is a white monochrome mark on transparency, which means it is
 * invisible on the light theme. Rather than ask for a second file, it is
 * inverted by CSS under light — safe precisely because it is monochrome, where
 * inverting a colour logo would produce something unrecognisable.
 *
 * Served from /public rather than hot-linked from the GoHighLevel CDN: the
 * header of every page should not depend on somebody else's uptime, and a local
 * file is cached alongside the rest of the app.
 *
 * The file carries a wide transparent margin of its own, so the box is sized to
 * the mark rather than the image and object-contain does the rest.
 */
export function Logo({
  className,
  width = 132,
  height = 34,
  priority = false,
}: {
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
}) {
  return (
    <Image
      src="/apex-logo.webp"
      alt={tenant.company.name}
      width={width}
      height={height}
      priority={priority}
      // logo-mark is defined in globals.css and inverts under the light theme.
      // Not a Tailwind `dark:` variant, because this app themes by a data-theme
      // attribute rather than a class, so `dark:` would never fire.
      className={cn('logo-mark h-auto w-auto object-contain', className)}
      style={{ maxWidth: width, maxHeight: height }}
    />
  );
}
