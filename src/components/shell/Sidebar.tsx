'use client';

/**
 * Navigation.
 *
 * The four sections follow how the business actually runs — you win a clinic,
 * you onboard and serve it, its patients book consultations, and separately
 * there is the business of running the agency. So the menu reads as a
 * lifecycle rather than an alphabetical list of features.
 *
 * Each item's permission key comes from its href, through the same map the
 * middleware guard uses — so a hidden item is also an unreachable URL rather
 * than merely an invisible one. Labels here are free to change; the keys in
 * config/permissions.ts are not.
 */
import {
  BadgeDollarSign,
  BarChart3,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  FileText,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  MessagesSquare,
  PhoneCall,
  Scale,
  Settings,
  Target,
  UserCircle,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ThemeToggle, type Theme } from '@/components/shell/ThemeToggle';
import { permissionForPath } from '@/config/permissions';
import { tenant } from '@/config/tenant.config';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Structure is shown before the page exists, so the shape is legible. */
  pending?: boolean;
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    heading: 'B2B — winning clients',
    items: [
      { href: '/pipeline', label: 'B2B Overview', icon: GitBranch },
      { href: '/leads', label: 'Leads', icon: Target },
      { href: '/sales-tracker', label: 'Sales Tracker', icon: ClipboardList },
      { href: '/b2b-ads', label: 'B2B Ads Tracker', icon: BarChart3 },
    ],
  },
  {
    heading: 'Clients — serving them',
    items: [
      { href: '/dashboard', label: 'Clients Overview', icon: LayoutDashboard },
      { href: '/onboarding', label: 'Client Onboarding', icon: CalendarCheck },
      { href: '/clients', label: 'Client Management', icon: Users },
      { href: '/ads', label: 'Ads Management', icon: Megaphone },
      { href: '/compare', label: 'Client Results Tracker', icon: Scale },
    ],
  },
  {
    heading: 'Patients',
    items: [
      { href: '/b2c', label: 'Consultations', icon: BadgeDollarSign },
      { href: '/call-center', label: 'Call Center', icon: PhoneCall },
    ],
  },
  {
    heading: 'Company',
    items: [
      { href: '/meetings', label: 'Meetings', icon: MessagesSquare },
      { href: '/projects', label: 'Projects', icon: ClipboardList },
      { href: '/hr', label: 'Team', icon: UsersRound },
      { href: '/tech-support', label: 'Tech Support', icon: LifeBuoy },
      { href: '/forms', label: 'Forms', icon: FileText },
      { href: '/finance', label: 'Finance', icon: Wallet },
      { href: '/billing', label: 'Billing', icon: CreditCard },
    ],
  },
];

/** Sits at the foot rather than in a section — it is about you, not the work. */
const ACCOUNT_ITEMS: NavItem[] = [
  { href: '/account', label: 'My Account', icon: UserCircle },
  { href: '/settings/access', label: 'Access & Permissions', icon: KeyRound },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Whether this person may see the item. A route with no rule in the map is
 * admin-only, so an unmapped item stays hidden rather than showing for all.
 */
function isAllowed(item: NavItem, allowed: Set<string>): boolean {
  const key = permissionForPath(item.href);
  return key !== null && allowed.has(key);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;

  if (item.pending) {
    return (
      <span
        className="mb-0.5 flex cursor-default items-center gap-2.5 rounded-md px-3 py-2 text-sm text-fg-subtle"
        title="Not built yet"
      >
        <Icon size={16} />
        <span className="truncate">{item.label}</span>
        <span className="ml-auto rounded-full bg-surface-sunken px-1.5 py-0.5 text-[10px] font-medium">
          soon
        </span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn(
        'mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-accent-subtle font-medium text-accent'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Icon size={16} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function Sidebar({
  permissions,
  theme,
}: {
  permissions: readonly string[];
  theme: Theme;
}) {
  const pathname = usePathname();
  const allowed = new Set(permissions);

  // /settings/access must not also light up /settings, so the longest matching
  // href wins rather than any prefix match.
  const allHrefs = [...SECTIONS.flatMap((s) => s.items), ...ACCOUNT_ITEMS]
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`));
  const activeHref = allHrefs.sort((a, b) => b.length - a.length)[0] ?? null;

  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => isAllowed(item, allowed)),
  })).filter((section) => section.items.length > 0);

  const visibleAccount = ACCOUNT_ITEMS.filter((item) =>
    isAllowed(item, allowed),
  );

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-surface">
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

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {visibleSections.map((section) => (
          <div key={section.heading} className="mb-5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              {section.heading}
            </p>
            {section.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={activeHref === item.href}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-2 py-3">
        {visibleAccount.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={activeHref === item.href}
          />
        ))}
        <div className="mt-3 px-1">
          <ThemeToggle initial={theme} />
        </div>
      </div>
    </aside>
  );
}
