/**
 * Token resolution for the client portal.
 *
 * The portal has no login: the URL is the credential. That makes this function
 * the entire security boundary, so every portal page and every portal write
 * goes through it and scopes its queries to what it returns. A wrong token
 * resolves to nothing rather than to somebody else's practice, and a disabled
 * portal is indistinguishable from a wrong token on purpose — saying "this
 * practice exists but is switched off" would confirm the practice exists.
 */
import { serviceClient } from '@/lib/supabase/service';

export interface PortalLocation {
  id: string;
  name: string;
  timezone: string;
}

export interface PortalContext {
  token: string;
  group: {
    id: string;
    name: string;
    currency: string;
    onboardingStage: string;
    status: string;
  };
  locations: PortalLocation[];
  locationIds: string[];
}

export async function resolvePortal(
  token: string,
): Promise<PortalContext | null> {
  if (!token) return null;

  const db = serviceClient();

  const group = await db
    .from('client_groups')
    .select('id, name, currency, portal_enabled, onboarding_stage, status')
    .eq('portal_token', token)
    .maybeSingle();

  if (group.error) throw group.error;
  if (!group.data || !group.data.portal_enabled) return null;

  const locations = await db
    .from('clients')
    .select('id, name, timezone')
    .eq('group_id', group.data.id)
    .order('name');

  if (locations.error) throw locations.error;

  const rows = locations.data ?? [];

  return {
    token,
    group: {
      id: group.data.id,
      name: group.data.name,
      currency: group.data.currency,
      onboardingStage: group.data.onboarding_stage,
      status: group.data.status,
    },
    locations: rows,
    locationIds: rows.map((row) => row.id),
  };
}

/**
 * The pages a clinic can reach. Ordered by how often they are needed, not by
 * how the data is structured — consultations first, because that is the reason
 * anybody opens this link.
 */
export const PORTAL_PAGES: ReadonlyArray<{ href: string; label: string }> = [
  { href: '', label: 'Dashboard' },
  { href: '/appointments', label: 'Post consultation' },
  { href: '/creatives', label: 'Ads Creative' },
  { href: '/onboarding', label: 'Onboarding' },
  { href: '/agency-appointments', label: 'Calls with us' },
  { href: '/account', label: 'Account' },
];

/*
 * Not in the nav yet, because the pages do not exist:
 *
 *   /consultations — upcoming appointments. Distinct from /appointments, which
 *                    is the outcome form for ones that have happened.
 *   /support       — tickets, a thread with images, and booking a call. Would
 *                    absorb "Calls with us", which is the booking half already.
 *
 * Listing them here as tabs before they exist would give a client two dead
 * links, which is worse than a shorter menu.
 *
 * /update-info and /invite-request are gone from the nav but their pages still
 * work: /account supersedes both, and an old link somebody bookmarked should not
 * 404.
 */

/**
 * The GoHighLevel form that collects card details.
 *
 * A form id rather than a card form of our own, deliberately. The fields render
 * inside GoHighLevel's iframe, so a card number never touches this app — no PCI
 * scope, and no chance of a CVV being written to a column. See CardDetailsForm.
 */
export const CARD_DETAILS_FORM_ID = 'KbkpELbls32iZqQ004BH';
