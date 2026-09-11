'use client';

import {
  Award,
  BadgeDollarSign,
  LayoutDashboard,
  MessageSquareText,
  Table2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { cn } from '@/lib/cn';

interface Section {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

/**
 * The call centre's own menu.
 *
 * Everything here used to be one page, stacked five panels deep, and the only
 * way to reach the commission table was to scroll past three other tables that
 * happen to sit above it. Each panel answers a different question for a
 * different person — a team lead wants the board, whoever runs payroll wants
 * commission — so they are sections, not a single report.
 *
 * The hints are not decoration. "Board" and "Scoreboard" are nearly the same
 * word and hold different things, and one line each is cheaper than somebody
 * opening both every time.
 */
const SECTIONS: readonly Section[] = [
  {
    href: '/call-center',
    label: 'Role efficiency',
    hint: 'Per agent, by role',
    icon: LayoutDashboard,
  },
  {
    href: '/call-center/board',
    label: 'Team board',
    hint: 'Daily stats, our own feed',
    icon: Table2,
  },
  {
    href: '/call-center/calls',
    label: 'Call reviews',
    hint: 'Transcripts and grading',
    icon: MessageSquareText,
  },
  {
    href: '/call-center/commission',
    label: 'Commission',
    hint: 'Rolling 30 days',
    icon: BadgeDollarSign,
  },
  {
    href: '/call-center/bookings',
    label: 'Bookings',
    hint: 'Who is booking',
    icon: Award,
  },
];

export function CallCentreNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /*
   * The chosen date range travels with every link. Without this, moving from
   * the board to commission silently resets the window to the default, and the
   * two panels would be describing different fortnights while looking like one
   * report.
   */
  const query = searchParams.toString();
  const suffix = query ? `?${query}` : '';

  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-4 py-3 lg:w-60 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:px-3 lg:py-5">
      {SECTIONS.map((section) => {
        /*
         * Exact match for the index, prefix for the rest. A startsWith test on
         * '/call-center' alone marks every section active at once, and the
         * per-agent pages under /call-center/<id> should leave the index lit
         * rather than nothing.
         */
        const active =
          section.href === '/call-center'
            ? pathname === '/call-center' ||
              !SECTIONS.some(
                (other) =>
                  other.href !== '/call-center' &&
                  pathname.startsWith(other.href),
              )
            : pathname.startsWith(section.href);

        const Icon = section.icon;

        return (
          <Link
            key={section.href}
            href={`${section.href}${suffix}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 transition-colors lg:shrink',
              active
                ? 'bg-accent-subtle text-accent'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            <Icon size={16} className="shrink-0" />
            <span className="min-w-0">
              <span className="block whitespace-nowrap text-sm font-medium">
                {section.label}
              </span>
              {/* Hidden on narrow screens, where the menu is a scrolling strip
                  and a second line would double its height for no gain. */}
              <span className="hidden truncate text-xs text-fg-subtle lg:block">
                {section.hint}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
