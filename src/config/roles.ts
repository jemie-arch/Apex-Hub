/**
 * Who somebody is, and what that entitles them to.
 *
 * ============================== DO NOT RENAME ==============================
 * These strings are the user_role enum in Postgres and the `role` claim in the
 * JWT. Renaming one is a migration, not an edit. Labels are free to change.
 * ===========================================================================
 *
 * Two separate ideas live in this one column, which is worth being explicit
 * about because conflating them is how people end up locked out of their own
 * software:
 *
 *   PRIVILEGE  super_admin and admin reach everything, and pass auth_is_admin()
 *              in the database so row-level security lets them read across
 *              clients.
 *   JOB        ceo, tech, media_buyer, isa, csm say what someone does. They
 *              carry no special reach on their own; what each person sees is
 *              their permission keys, granted on Access & Permissions.
 *
 * A job title is deliberately not a privilege. Making 'ceo' implicitly
 * all-powerful would mean the only way to give someone the finance page is to
 * make them chief executive.
 */
export const USER_ROLES = [
  'super_admin',
  'admin',
  'ceo',
  'media_buyer',
  'tech',
  'isa',
  'csm',
  // Pre-date the job titles above. Kept because enum values cannot be dropped
  // while rows still reference them, and because they still mean something:
  // isr is the old name for isa, csr for csm.
  'isr',
  'csr',
  // Not staff. A client login is scoped to its own practice and must never be
  // offered when adding a teammate.
  'client',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  ceo: 'CEO',
  media_buyer: 'Media Buyer',
  tech: 'Tech',
  isa: 'ISA',
  csm: 'CSM',
  isr: 'ISA (legacy)',
  csr: 'CSM (legacy)',
  client: 'Client',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  super_admin: 'Everything, and cannot be locked out by another admin.',
  admin: 'Everything, including access and billing.',
  ceo: 'Whatever pages you grant. No implicit reach.',
  media_buyer: 'Ads, campaigns and creative performance.',
  tech: 'Integrations, syncs and support.',
  isa: 'Calls out, appointments booked.',
  csm: 'Client relationships and fulfilment.',
  isr: 'Superseded by ISA. Kept for existing accounts.',
  csr: 'Superseded by CSM. Kept for existing accounts.',
  client: 'A practice logging in to their own portal.',
};

/** Offered when adding or editing a teammate. Excludes client and the legacy pair. */
export const ASSIGNABLE_ROLES: readonly UserRole[] = [
  'super_admin',
  'admin',
  'ceo',
  'media_buyer',
  'tech',
  'isa',
  'csm',
];

/** Reaches every page and passes auth_is_admin() in the database. */
export const PRIVILEGED_ROLES: readonly UserRole[] = ['super_admin', 'admin'];

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/**
 * Staff who are not privileged: everybody whose access is decided by their
 * permission keys.
 *
 * Written as "a known role that is neither privileged nor a client" rather than
 * as a list, so adding a role to USER_ROLES cannot leave routing unaware of it.
 * The previous version named isr and csr explicitly, and every job role added
 * afterwards was routed to a 404 on every page.
 */
export function isStaffRole(role: string | null | undefined): boolean {
  if (role == null) return false;
  if (!isUserRole(role)) return false;
  return role !== 'client' && !isPrivileged(role);
}

/**
 * Whether this role reaches everything.
 *
 * Every `role === 'admin'` comparison in the app was replaced by a call to
 * this. Adding a second privileged role by hand would have meant finding nine
 * scattered comparisons and getting all nine right.
 */
export function isPrivileged(role: string | null | undefined): boolean {
  return role != null && (PRIVILEGED_ROLES as readonly string[]).includes(role);
}

/** Only a super admin may create or demote another super admin. */
export function canAssign(callerRole: string, target: UserRole): boolean {
  if (target === 'super_admin') return callerRole === 'super_admin';
  return isPrivileged(callerRole);
}

/**
 * Roles that work the phones, so have a call-centre performance page.
 *
 * isr and csr are the former names of isa and csm; all four belong here, which
 * is why this is a helper and not two equality checks at each call site.
 */
export function isCallerRole(role: string | null | undefined): boolean {
  return role === 'isa' || role === 'csm' || role === 'isr' || role === 'csr';
}

export function roleLabel(role: string | null | undefined): string {
  if (role == null) return 'Unknown';
  return isUserRole(role) ? ROLE_LABELS[role] : role;
}
