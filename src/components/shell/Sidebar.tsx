'use client';

/**
 * Navigation. Every label comes from tenant.config — the two funnels are named
 * groups here so it is never ambiguous which one a page belongs to.
 */
import {
  BarChart3,
  ClipboardList,
  GitBranch,
  LayoutDashboard,
  Megaphone,
  PhoneCall,
  Scale,
  Settings,
  Target,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { tenant, titleCase } from '@/config/tenant.config';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  /**
   * LucideIcon rather than ComponentType<{ size?: number }> — lucide's `size`
   * accepts string | number, so the narrower shape rejects every icon.
   */
  icon: LucideIcon;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

function groups(): NavGroup[] {
  const { client, booking, isr } = tenant.vocabulary;

  return [
    {
      heading: 'Overview',
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/clients', label: titleCase(client.plural), icon: Users },
        { href: '/onboarding', label: 'Onboarding', icon: ClipboardList },
        { href: '/compare', label: 'Compare', icon: Scale },
      ],
    },
    {
      // Us selling to clients.
      heading: tenant.funnels.b2b,
      items: [
        { href: '/pipeline', label: 'Pipeline', icon: GitBranch },
        { href: '/sales-tracker', label: 'Sales tracker', icon: Target },
        {
          // The page carries both call-centre roles; the ISR view is default.
          href: '/call-center',
          label: `${isr.singular} performance`,
          icon: PhoneCall,
        },
      ],
    },
    {
      // A client selling to their end users.
      heading: tenant.funnels.b2c,
      items: [
        { href: '/ads', label: 'Ads', icon: Megaphone },
        {
          href: '/ads-performance',
          label: `${titleCase(booking.singular)} economics`,
          icon: BarChart3,
        },
      ],
    },
    {
      heading: 'Admin',
      items: [{ href: '/settings', label: 'Settings', icon: Settings }],
    },
  ];
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md',
            'bg-accent text-sm font-semibold text-accent-contrast',
          )}
          aria-hidden
        >
          {tenant.company.initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">
            {tenant.company.name}
          </p>
          <p className="truncate text-xs text-fg-subtle">
            {tenant.company.tagline}
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-6">
        {groups().map((group) => (
          <div key={group.heading} className="mb-5">
            <p className="px-3 pb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">
              {group.heading}
            </p>
            {group.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm',
                    'transition-colors',
                    active
                      ? 'bg-accent-subtle font-medium text-accent'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )}
                >
                  <Icon size={16} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
