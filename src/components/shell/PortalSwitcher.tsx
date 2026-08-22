'use client';

/**
 * Moves between the three portals.
 *
 * They are three different jobs rather than three views of one job: the internal
 * portal runs the agency, the call centre is a shift you work all day, and the
 * client portal belongs to somebody outside the company. Putting them behind one
 * sidebar meant an ISA scrolling past the agency's billing to reach their own
 * queue.
 *
 * The client portal is the odd one out and deliberately so — it is per-client and
 * authenticated by a token in its URL, so there is no single address for "the
 * client portal". This links to Client Management, which is where a client's own
 * link is found.
 */
import { Building2, Check, ChevronsUpDown, PhoneCall, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

interface Portal {
  key: 'internal' | 'call-center' | 'client';
  label: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  /** Paths that mean "you are in this portal". */
  owns: (pathname: string) => boolean;
}

const PORTALS: Portal[] = [
  {
    key: 'internal',
    label: 'Internal Portal',
    hint: 'Run the agency',
    href: '/dashboard',
    icon: Building2,
    owns: (pathname) =>
      !pathname.startsWith('/call-center') &&
      !pathname.startsWith('/client-portal'),
  },
  {
    key: 'call-center',
    label: 'Call Center',
    hint: 'Calls and ISA performance',
    href: '/call-center',
    icon: PhoneCall,
    owns: (pathname) => pathname.startsWith('/call-center'),
  },
  {
    key: 'client',
    label: 'Client Portal',
    hint: 'Choose a client, then open theirs',
    // Not a portal you can switch into — there is one per client and the URL is
    // the credential, so the only honest destination is a page that asks which.
    href: '/client-portal',
    icon: Users,
    owns: (pathname) => pathname.startsWith('/client-portal'),
  },
];

export function PortalSwitcher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape, so it behaves like a menu rather than
  // a panel you have to click twice to dismiss.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = PORTALS.find((portal) => portal.owns(pathname)) ?? PORTALS[0]!;
  const CurrentIcon = current.icon;

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2',
          'text-sm text-fg transition-colors hover:bg-surface-hover',
        )}
      >
        <CurrentIcon size={15} className="text-accent" />
        <span className="font-medium">{current.label}</span>
        <ChevronsUpDown size={14} className="text-fg-subtle" />
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-50 mt-1.5 w-72 overflow-hidden rounded-lg',
            'border border-line bg-surface shadow-lg',
          )}
        >
          {PORTALS.map((portal) => {
            const Icon = portal.icon;
            const active = portal.key === current.key;

            return (
              <Link
                key={portal.key}
                href={portal.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-start gap-2.5 border-b border-line px-3 py-2.5 last:border-0',
                  'transition-colors hover:bg-surface-hover',
                )}
              >
                <Icon
                  size={15}
                  className={cn('mt-0.5', active ? 'text-accent' : 'text-fg-subtle')}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">
                    {portal.label}
                  </span>
                  <span className="block text-xs text-fg-subtle">
                    {portal.hint}
                  </span>
                </span>
                {active ? (
                  <Check size={14} className="mt-0.5 text-accent" />
                ) : null}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
