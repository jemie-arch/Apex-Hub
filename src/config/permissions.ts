/**
 * Menu permission keys.
 *
 * ============================== DO NOT RENAME ==============================
 * These strings are stored per user in user_profiles.permissions. Renaming one
 * silently revokes that page for everybody who had it, and nothing will fail
 * loudly — the menu item simply stops appearing.
 *
 * Change a LABEL freely. Never change a KEY.
 * ===========================================================================
 */
export const PERMISSION_KEYS = [
  // B2B — winning clients
  'pipeline',
  'b2b_leads',
  'sales_tracker',
  'b2b_ads',
  // Clients — serving them
  'overview',
  'onboarding',
  'client_management',
  'ads_management',
  'compare',
  'fulfilment',
  'onboarding_forms',
  'client_onboarding',
  'provisioning',
  // Patients
  'consultations',
  'calls',
  // Company
  'meetings',
  'projects',
  'hr',
  'tech_support',
  'forms',
  'finance',
  'billing',
  // Account menu
  'account',
  'access',
  'settings',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Human labels for the access screen. Safe to change; the keys are not. */
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  pipeline: 'B2B Overview',
  b2b_leads: 'Leads',
  sales_tracker: 'Sales Tracker',
  b2b_ads: 'B2B Ads Tracker',
  overview: 'Clients Overview',
  onboarding: 'Onboarding Overview',
  client_management: 'Client Management',
  ads_management: 'Ads Management',
  compare: 'Client Results Tracker',
  fulfilment: 'Fulfilment',
  onboarding_forms: 'Onboarding Forms',
  client_onboarding: 'Client Onboarding',
  provisioning: 'Provisioning',
  consultations: 'Consultations',
  calls: 'Call Center',
  meetings: 'Meetings',
  projects: 'Projects',
  hr: 'Team',
  tech_support: 'Tech Support',
  forms: 'Forms',
  finance: 'Finance',
  billing: 'Billing',
  account: 'My Account',
  access: 'Access & Permissions',
  settings: 'Settings',
};

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/**
 * Route → permission key.
 *
 * The same map drives the sidebar and the middleware guard, so a page cannot
 * be hidden from the menu while still being reachable by typing the URL. Match
 * is by longest prefix, which is why /settings/access resolves to `access` and
 * not to `settings`.
 *
 * A route absent from this map is reachable by admins only — deny by default,
 * so forgetting an entry locks a page down rather than opening it up.
 */
export const ROUTE_PERMISSIONS: ReadonlyArray<readonly [string, PermissionKey]> =
  [
    ['/pipeline', 'pipeline'],
    ['/leads', 'b2b_leads'],
    ['/sales-tracker', 'sales_tracker'],
    ['/b2b-ads', 'b2b_ads'],
    ['/dashboard', 'overview'],
    ['/onboarding', 'onboarding'],
    ['/clients', 'client_management'],
    // The index of client portals. Same audience as client management, so it
    // shares the key rather than inventing one nobody has been granted.
    ['/client-portal', 'client_management'],
    ['/ads', 'ads_management'],
    ['/ads-performance', 'ads_management'],
    ['/compare', 'compare'],
    ['/fulfilment', 'fulfilment'],
    ['/onboarding-forms', 'onboarding_forms'],
    // Longer prefix than '/onboarding', so it resolves to its own key.
    ['/onboarding/clients', 'client_onboarding'],
    ['/onboarding/provisioning', 'provisioning'],
    ['/b2c', 'consultations'],
    ['/call-center', 'calls'],
    ['/meetings', 'meetings'],
    ['/projects', 'projects'],
    ['/hr', 'hr'],
    ['/tech-support', 'tech_support'],
    ['/forms', 'forms'],
    ['/finance', 'finance'],
    ['/billing', 'billing'],
    ['/account', 'account'],
    ['/settings/access', 'access'],
    ['/settings', 'settings'],
  ];

/**
 * Somewhere sensible to land, given what this person holds.
 *
 * Sign-in used to send anyone without the `overview` key to their call-centre
 * performance page, which is the right answer for a caller and meaningless for a
 * media buyer or a tech. This walks the routes in menu order and returns the
 * first one they can actually open.
 */
export function firstAllowedRoute(granted: readonly string[]): string | null {
  const held = new Set(granted);

  // Menu order, so the landing page is the top of what they can see rather than
  // whichever route happens to sort first.
  const preferred = ['/dashboard', '/pipeline', '/ads', '/clients', '/fulfilment'];
  for (const route of preferred) {
    const key = permissionForPath(route);
    if (key !== null && held.has(key)) return route;
  }

  for (const [route, key] of ROUTE_PERMISSIONS) {
    if (held.has(key) && route !== '/account') return route;
  }

  return held.has('account') ? '/account' : null;
}

/** The key a path requires, or null if no rule covers it. */
export function permissionForPath(pathname: string): PermissionKey | null {
  let bestPrefix = '';
  let bestKey: PermissionKey | null = null;

  for (const [prefix, key] of ROUTE_PERMISSIONS) {
    const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (matches && prefix.length > bestPrefix.length) {
      bestPrefix = prefix;
      bestKey = key;
    }
  }

  return bestKey;
}
