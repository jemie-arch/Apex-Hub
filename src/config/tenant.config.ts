/**
 * Tenant vocabulary and branding. The ONLY place these words live. Components
 * read from here; none of them spell out a noun inline.
 */

/** A noun the UI pluralises and capitalises in different places. */
export interface Noun {
  singular: string;
  plural: string;
}

/**
 * The metric rendered outsized on /dashboard. This is the DEFAULT — the live
 * value comes from app_settings.hero_metric, so an admin can change which
 * number is the big one without a deploy. Every option is already on the page
 * as a smaller tile.
 */
export type HeroMetricKey =
  | 'clients_toward_goal'
  | 'revenue_this_month'
  | 'bookings_this_month'
  | 'booked_to_shown_rate'
  | 'cost_per_booking'
  | 'return_on_ad_spend'
  | 'active_clients';

export interface TenantConfig {
  company: {
    name: string;
    /** Single character for the sidebar mark. */
    initial: string;
    tagline: string;
    industry: string;
  };
  vocabulary: {
    /**
     * The BUSINESS — a practice. What the 100-client goal counts, what signs
     * the retainer, what logs into the portal.
     */
    client: Noun;
    /**
     * One CRM sub-account belonging to a client. A practice has several when
     * its sites are far enough apart to need their own area code.
     */
    location: Noun;
    /** What our client calls THEIR customer. */
    endUser: Noun;
    /** The thing that gets booked in the b2c funnel. */
    booking: Noun;
    /** Call centre: outbound, measured on dials and bookings. */
    isr: Noun;
    /** Call centre: inbound handling, measured on call quality. */
    csr: Noun;
  };
  /** Labels for the two funnels. Never collapse these into one word. */
  funnels: {
    b2b: string;
    b2c: string;
  };
  heroMetric: HeroMetricKey;
  /** Fallback zone when a location row has none. Locations override this. */
  defaultTimezone: string;
  defaultCurrency: string;
}

export const tenant: TenantConfig = {
  company: {
    name: 'Apex Dental Marketing',
    initial: 'A',
    tagline: 'Client Hub',
    industry: 'Patient acquisition for dental and orthodontic practices',
  },
  vocabulary: {
    client: { singular: 'client', plural: 'clients' },
    location: { singular: 'location', plural: 'locations' },
    endUser: { singular: 'patient', plural: 'patients' },
    // 'Appointment' rather than consult or new patient: it is the neutral term
    // and matches what the CRM calls the record. Consult and new-patient are
    // kinds OF appointment — telling those apart wants a type column, not a
    // different word for all of them.
    booking: { singular: 'appointment', plural: 'appointments' },
    isr: { singular: 'ISR', plural: 'ISRs' },
    csr: { singular: 'CSR', plural: 'CSRs' },
  },
  funnels: {
    // Apex selling retainers to practices.
    b2b: 'New business',
    // A practice booking patients.
    b2c: 'Patient acquisition',
  },
  heroMetric: 'clients_toward_goal',
  defaultTimezone: 'America/New_York',
  defaultCurrency: 'USD',
};

/** Title Case a noun for headings, without touching the config values. */
export function titleCase(value: string): string {
  return value.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/**
 * Values still guessed rather than confirmed. Listed explicitly because a
 * readable default is indistinguishable from a confirmed one by inspection, so
 * scanning the values for a marker would quietly report all-clear. Delete a
 * line once it is confirmed.
 */
export const UNCONFIRMED_TENANT_FIELDS: readonly string[] = [
  'brand accent — globals.css still uses a placeholder indigo',
];

/** True while any tenant value is unconfirmed. Surfaced in /settings. */
export function hasUnresolvedTenantPlaceholders(): boolean {
  return (
    JSON.stringify(tenant).includes('TODO(tenant)') ||
    UNCONFIRMED_TENANT_FIELDS.length > 0
  );
}
