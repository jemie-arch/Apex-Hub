'use client';

/**
 * Navigation.
 *
 * Three sections, in the order the business actually runs: Company is Apex's own
 * business — winning clients and billing them; Clients is the work done for them
 * once won; Teams is running the agency itself.
 *
 * Call Center is deliberately absent. It is its own portal now, reached from the
 * switcher, because the people who live in it all day should not have to scroll
 * past the agency's finances to find it.
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
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  MessagesSquare,
  Scale,
  Server,
  Settings,
  Target,
  UserCheck,
  UserCircle,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { Logo } from '@/components/shell/Logo';
import { ThemeToggle, type Theme } from '@/components/shell/ThemeToggle';
import {
  ADMIN_ONLY_PERMISSIONS,
  permissionForPath,
} from '@/config/permissions';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Structure is shown before the page exists, so the shape is legible. */
  pending?: boolean;
  /**
   * Pages that belong under this one.
   *
   * A parent with children is still a real page in its own right — Client
   * Management is a page that happens to contain the results tracker. A parent
   * with no page of its own uses href '' and renders as a heading, which is how
   * Tracker groups the two b2b trackers without inventing a route for itself.
   */
  children?: NavItem[];
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    // Apex's own business: winning and billing clients.
    heading: 'Company',
    items: [
      { href: '/pipeline', label: 'Overview', icon: GitBranch },
      { href: '/leads', label: 'Leads', icon: Target },
      {
        // No page of its own — purely a home for the two b2b trackers.
        href: '',
        label: 'Tracker',
        icon: BarChart3,
        children: [
          { href: '/sales-tracker', label: 'Sales', icon: ClipboardList },
          { href: '/b2b-ads', label: 'Ads', icon: BarChart3 },
        ],
      },
      { href: '/billing', label: 'Billing', icon: CreditCard },
    ],
  },
  {
    // The work done for clients.
    heading: 'Clients',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      {
        href: '/onboarding',
        label: 'Onboarding',
        icon: CalendarCheck,
        /*
         * Provisioning moved to the settings group and Forms dropped from the
         * menu. Onboarding is now just the two pages the client-facing team
         * uses; provisioning is an admin operation that happens to start here,
         * and listing it beside them invited someone to press it.
         *
         * Both pages still exist and both are still permission-gated. Forms is
         * reachable by URL at /onboarding-forms — the same arrangement /billing
         * has always had — so nothing was deleted, only unlisted.
         */
        children: [
          { href: '/onboarding/clients', label: 'Client Onboarding', icon: UserCheck },
        ],
      },
      {
        href: '/clients',
        label: 'Client Management',
        icon: Users,
        children: [
          { href: '/compare', label: 'Results Tracker', icon: Scale },
        ],
      },
      { href: '/ads', label: 'Ads Management', icon: Megaphone },
      {
        href: '/fulfilment',
        label: 'Fulfilment',
        icon: ClipboardCheck,
        children: [
          { href: '/reconciliation', label: 'Reconciliation', icon: Scale },
        ],
      },
      { href: '/b2c', label: 'Consultations', icon: BadgeDollarSign },
    ],
  },
  {
    // Running the agency itself.
    heading: 'Teams',
    items: [
      { href: '/hr', label: 'Team', icon: UsersRound },
      { href: '/meetings', label: 'Meetings', icon: MessagesSquare },
      { href: '/projects', label: 'Projects', icon: ClipboardList },
      { href: '/tech-support', label: 'Tech Support', icon: LifeBuoy },
      { href: '/forms', label: 'Forms', icon: FileText },
      { href: '/finance', label: 'Finance', icon: Wallet },
    ],
  },
];

/** Sits at the foot rather than in a section — it is about you, not the work. */
const ACCOUNT_ITEMS: NavItem[] = [
  { href: '/account', label: 'My Account', icon: UserCircle },
  { href: '/settings/access', label: 'Access & Permissions', icon: KeyRound },
  /*
   * Super-admin only, via ADMIN_ONLY_PERMISSIONS. It cannot be granted on the
   * access screen at any role, and an 'admin' does not inherit it the way they
   * inherit every other page — because this one creates live GoHighLevel
   * sub-accounts rather than reporting on them.
   */
  { href: '/onboarding/provisioning', label: 'Provisioning', icon: Server },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Whether this person may see the item. A route with no rule in the map is
 * admin-only, so an unmapped item stays hidden rather than showing for all.
 *
 * An admin sees everything that has a rule. Middleware already grants them the
 * route, so the stored key list was only deciding whether they could find it —
 * which meant every newly added page was invisible until somebody appended its
 * key to each existing row. /billing shipped exactly that way: reachable by URL,
 * absent from the menu.
 */
function isAllowed(
  item: NavItem,
  allowed: Set<string>,
  isAdmin: boolean,
  isSuperAdmin: boolean,
): boolean {
  const key = permissionForPath(item.href);
  if (key === null) return false;
  // Admin-only keys ignore the granted list entirely. Provisioning creates live
  // GoHighLevel sub-accounts, so holding the string is not enough.
  if (ADMIN_ONLY_PERMISSIONS.has(key)) return isSuperAdmin;
  return isAdmin || allowed.has(key);
}

/**
 * The item as this person should see it, or null if they should not.
 *
 * Children are filtered independently, so somebody with Client Management but
 * not the results tracker sees the parent without the child. A pure grouping
 * item — one with no page of its own — survives only while it still has a
 * child worth showing, rather than lingering as a heading over nothing.
 */
function visible(
  item: NavItem,
  allowed: Set<string>,
  isAdmin: boolean,
  isSuperAdmin: boolean,
): NavItem | null {
  const children = item.children
    ?.map((child) => visible(child, allowed, isAdmin, isSuperAdmin))
    .filter((child): child is NavItem => child !== null);

  const isGroupOnly = item.href === '';

  if (isGroupOnly) {
    return children && children.length > 0 ? { ...item, children } : null;
  }

  if (!isAllowed(item, allowed, isAdmin, isSuperAdmin)) {
    // The parent is denied but a child may still be permitted. Promote the
    // children rather than hiding a page somebody is entitled to.
    return children && children.length > 0
      ? { ...item, href: '', children }
      : null;
  }

  return children && children.length > 0 ? { ...item, children } : { ...item };
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
        'mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm',
        'transition-all duration-200',
        active
          ? 'bg-accent-subtle font-medium text-accent shadow-[inset_2px_0_0_0_var(--accent)]'
          : 'text-fg-muted hover:translate-x-0.5 hover:bg-surface-hover hover:text-fg',
      )}
    >
      <Icon size={16} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

/**
 * One nav item and whatever sits under it.
 *
 * Opens itself when the current page is inside it, so arriving at a nested page
 * by URL does not leave its own menu entry hidden. Otherwise it stays closed and
 * the section reads as a short list rather than a wall of links.
 */
function NavBranch({
  item,
  activeHref,
}: {
  item: NavItem;
  activeHref: string | null;
}) {
  const children = item.children ?? [];
  const holdsActive =
    activeHref !== null &&
    (activeHref === item.href ||
      children.some((child) => child.href === activeHref));

  const [open, setOpen] = useState(holdsActive);
  const Icon = item.icon;

  if (children.length === 0) {
    return <NavLink item={item} active={activeHref === item.href} />;
  }

  // href '' means this is a grouping label with no page behind it, so it must
  // not render as a link to nowhere.
  const parentIsPage = item.href !== '';

  return (
    <div className="mb-0.5">
      <div className="flex items-center">
        {parentIsPage ? (
          <Link
            href={item.href}
            className={cn(
              'flex flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
              activeHref === item.href
                ? 'bg-accent-subtle font-medium text-accent'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
          >
            <Icon size={16} />
            <span className="truncate">{item.label}</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            className="flex flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            aria-expanded={open}
          >
            <Icon size={16} />
            <span className="truncate">{item.label}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          className="mr-1 rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${item.label}`}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {open ? (
        <div className="ml-4 border-l border-line pl-2">
          {children.map((child) => (
            <NavLink
              key={child.href}
              item={child}
              active={activeHref === child.href}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({
  permissions,
  isAdmin = false,
  isSuperAdmin = false,
  theme,
}: {
  permissions: readonly string[];
  /** Admins see every item — middleware already lets them reach every route. */
  isAdmin?: boolean;
  /** Narrower than isAdmin: gates pages that act on live systems. */
  isSuperAdmin?: boolean;
  theme: Theme;
}) {
  const pathname = usePathname();
  const allowed = new Set(permissions);

  // /settings/access must not also light up /settings, so the longest matching
  // href wins rather than any prefix match. Children are included, or a nested
  // page would leave its own entry unhighlighted.
  const everyHref = [
    ...SECTIONS.flatMap((section) =>
      section.items.flatMap((item) => [item.href, ...(item.children ?? []).map((c) => c.href)]),
    ),
    ...ACCOUNT_ITEMS.map((item) => item.href),
  ];
  const allHrefs = everyHref
    .filter((href) => href !== '')
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`));
  const activeHref = allHrefs.sort((a, b) => b.length - a.length)[0] ?? null;

  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .map((item) => visible(item, allowed, isAdmin, isSuperAdmin))
      .filter((item): item is NavItem => item !== null),
  })).filter((section) => section.items.length > 0);

  const visibleAccount = ACCOUNT_ITEMS.filter((item) =>
    isAllowed(item, allowed, isAdmin, isSuperAdmin),
  );

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-surface">
      {/*
        The wordmark carries the company name itself, so repeating it as text
        beside the logo would say the same thing twice. The tagline stays,
        because the mark does not carry that.
      */}
      <div className="px-5 py-6">
        <Logo height={48} priority />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {visibleSections.map((section) => (
          <div key={section.heading} className="mb-5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
              {section.heading}
            </p>
            {section.items.map((item) => (
              <NavBranch
                key={`${section.heading}:${item.href}:${item.label}`}
                item={item}
                activeHref={activeHref}
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
