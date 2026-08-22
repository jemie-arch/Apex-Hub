/**
 * The one list of syncs. The CLI scripts, the API route and vercel.json all
 * resolve through here, so a sync can never exist in the cron schedule but not
 * on the command line — which is exactly when you need to run it by hand.
 */
import { syncCrmAppointments } from '@/lib/sync/crm-appointments';
import { syncCrmCalls } from '@/lib/sync/crm-calls';
import { syncCrmClients } from '@/lib/sync/crm-clients';
import { syncCrmDeals } from '@/lib/sync/crm-deals';
import { syncOnboardingCalls } from '@/lib/sync/onboarding-calls';
import { syncProvisionPending } from '@/lib/sync/provision-pending';
import type { SyncFn } from '@/lib/sync/runner';
import { syncStripeCharges } from '@/lib/sync/stripe-charges';
import { syncWindsorAds } from '@/lib/sync/windsor-ads';

export interface SyncDefinition {
  name: string;
  description: string;
  run: SyncFn;
}

export const SYNCS: Record<string, SyncDefinition> = {
  'crm-clients': {
    name: 'crm-clients',
    description: 'GoHighLevel locations into clients',
    run: syncCrmClients,
  },
  'crm-appointments': {
    name: 'crm-appointments',
    description: 'GoHighLevel calendar events into b2c appointments',
    run: syncCrmAppointments,
  },
  'crm-deals': {
    name: 'crm-deals',
    description:
      "GoHighLevel opportunities into b2b deals — needs app_settings.b2b_location_id",
    run: syncCrmDeals,
  },
  'crm-calls': {
    name: 'crm-calls',
    description:
      'GoHighLevel conversation calls into the call-centre leaderboard',
    run: syncCrmCalls,
  },
  'onboarding-calls': {
    name: 'onboarding-calls',
    description:
      'Onboarding and launch calls from the ADM Client Onboarding sub-account ' +
      'onto each practice',
    run: syncOnboardingCalls,
  },
  'provision-pending': {
    name: 'provision-pending',
    description:
      'Builds the GoHighLevel sub-account for any onboarding submission that ' +
      'does not have a configured one yet',
    run: syncProvisionPending,
  },
  'windsor-ads': {
    name: 'windsor-ads',
    description:
      'Windsor.ai daily ad spend — campaigns, ads, per-ad-day and the rollup',
    run: syncWindsorAds,
  },
  'stripe-charges': {
    name: 'stripe-charges',
    description:
      'Stripe payment intents into billing — which client charges succeeded, ' +
      'were attempted, and failed',
    run: syncStripeCharges,
  },
};

/** Not written yet. Named so that nothing looks finished when it is not. */
export const PLANNED_SYNCS: readonly string[] = [];

export function findSync(name: string): SyncDefinition | null {
  return SYNCS[name] ?? null;
}
