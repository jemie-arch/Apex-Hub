'use client';

/**
 * A horizontally scrolling container with a second scrollbar above it.
 *
 * Thirty-three columns do not fit on any screen, so the table scrolls sideways.
 * The problem with the obvious implementation is that the only scrollbar sits
 * at the bottom of the table — so with the container capped at 72vh, a reader
 * arriving at the top sees a table that appears to end at "Amount Spent" and
 * concludes there is nothing further right. They have to scroll down through
 * forty rows to discover the control that would have told them otherwise.
 *
 * So there are two: a real one at the bottom, and a proxy above the header that
 * scrolls the same content. The proxy is an empty div wide enough to have a
 * scrollbar and nothing else, and the two are kept in step.
 *
 * The sync guard matters. Setting scrollLeft on one element fires that
 * element's own scroll event, which would set the other, which would set the
 * first — a loop that stutters visibly under a trackpad. `syncing` marks which
 * element the user is driving and drops the echo.
 */
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

export function WideTableScroll({
  children,
  maxHeight = '72vh',
  className,
}: {
  children: React.ReactNode;
  maxHeight?: string;
  className?: string;
}) {
  const proxy = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const syncing = useRef<'proxy' | 'body' | null>(null);
  const [contentWidth, setContentWidth] = useState(0);

  /*
   * The proxy's spacer has to match the table's real width, and that width
   * changes with the data, the window and the fonts once they load. Measured
   * rather than assumed, and re-measured on resize.
   */
  useEffect(() => {
    const element = body.current;
    if (!element) return;

    const measure = () => setContentWidth(element.scrollWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);

    return () => observer.disconnect();
  }, [children]);

  function drive(source: 'proxy' | 'body') {
    return () => {
      if (syncing.current && syncing.current !== source) return;
      syncing.current = source;

      const from = source === 'proxy' ? proxy.current : body.current;
      const to = source === 'proxy' ? body.current : proxy.current;
      if (from && to) to.scrollLeft = from.scrollLeft;

      // Released on the next frame, after the echo scroll event has fired.
      requestAnimationFrame(() => {
        syncing.current = null;
      });
    };
  }

  // Nothing to scroll: no proxy, and no empty gutter above the table either.
  const overflows = contentWidth > 0 && body.current !== null
    ? contentWidth > body.current.clientWidth
    : true;

  return (
    <div className={className}>
      {overflows ? (
        <div
          ref={proxy}
          onScroll={drive('proxy')}
          aria-hidden
          className="scrollbar-always overflow-x-auto overflow-y-hidden"
        >
          <div style={{ width: contentWidth, height: 1 }} />
        </div>
      ) : null}

      <div
        ref={body}
        onScroll={drive('body')}
        style={{ maxHeight }}
        className={cn('scrollbar-always overflow-auto')}
      >
        {children}
      </div>
    </div>
  );
}
