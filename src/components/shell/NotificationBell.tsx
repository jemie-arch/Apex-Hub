'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';

import { markNotificationsRead } from '@/components/shell/notification-actions';
import { cn } from '@/lib/cn';

export interface InboxItem {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  /** ISO. Rendered relative, because "2h ago" is what you want from a bell. */
  createdAt: string;
  read: boolean;
}

/**
 * How long ago, in the fewest words that are still true.
 *
 * Deliberately not date-fns's formatDistanceToNow, which says "about 2 hours"
 * — the hedge is honest and reads as noise at this size. Anything older than a
 * week gets a date instead, because "23 days ago" is a number nobody converts.
 */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * The bell, top right, beside the portal switcher.
 *
 * WHAT IT DOES NOT DO: poll. The list is whatever the layout read when the page
 * was rendered, so a notification that arrives while you sit on one screen
 * appears on your next navigation rather than instantly. That is a deliberate
 * first version — a bell that polls every thirty seconds is a database query
 * per user per thirty seconds forever, and this is a team of a dozen people who
 * navigate constantly. Worth revisiting with Supabase realtime if anybody
 * actually misses something; not worth the standing cost on day one.
 *
 * Opening the panel does not mark anything read. Reading is an act — you either
 * follow the link or press the button — because a bell that clears itself on a
 * glance is a bell that loses things you meant to come back to.
 */
export function NotificationBell({ items }: { items: readonly InboxItem[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const panel = useRef<HTMLDivElement>(null);

  const unread = items.filter((item) => !item.read).length;

  // Click-away and Escape. Without these the panel stays open behind whatever
  // you click next, which on a page of tables is immediately annoying.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (panel.current && !panel.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-label={
          unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`
        }
        className="relative flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface text-fg-muted transition hover:text-fg"
      >
        <Bell size={16} />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
            {/* Past nine the exact number stops changing the decision. */}
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-xs font-semibold text-fg">Notifications</span>
            {unread > 0 ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await markNotificationsRead();
                  })
                }
                className="text-xs text-fg-subtle hover:text-accent"
              >
                {isPending ? 'Marking…' : 'Mark all read'}
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-fg-subtle">
              Nothing yet. You will be told here when somebody tags you on a
              ticket or hands you one.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((item) => {
                const inner = (
                  <>
                    <span className="flex items-start gap-2">
                      {item.read ? null : (
                        <span
                          aria-hidden
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        />
                      )}
                      <span
                        className={cn(
                          'block text-xs',
                          item.read ? 'text-fg-muted' : 'font-medium text-fg',
                        )}
                      >
                        {item.title}
                      </span>
                    </span>
                    {item.body ? (
                      <span className="mt-0.5 block pl-3.5 text-xs text-fg-subtle">
                        {item.body}
                      </span>
                    ) : null}
                    <span className="mt-0.5 block pl-3.5 text-[11px] text-fg-subtle">
                      {ago(item.createdAt)}
                    </span>
                  </>
                );

                return (
                  <li key={item.id} className="border-b border-line last:border-0">
                    {item.href ? (
                      <Link
                        href={item.href}
                        onClick={() => {
                          setOpen(false);
                          // Only this one. Following a link is not a claim to
                          // have read the other five.
                          startTransition(async () => {
                            await markNotificationsRead([item.id]);
                          });
                        }}
                        className="block px-3 py-2.5 hover:bg-surface-sunken"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <span className="block px-3 py-2.5">{inner}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
