/**
 * The one list of syncs. The CLI scripts, the API route and vercel.json all
 * resolve through here, so a sync can never exist in the cron schedule but not
 * on the command line — which is exactly when you need to run it by hand.
 */
import { syncAppointmentLedger } from '@/lib/sync/appointment-ledger';
import { syncCrmAppointments } from '@/lib/sync/crm-appointments';
import { syncCrmCalls } from '@/lib/sync/crm-calls';
import { syncCrmClients } from '@/lib/sync/crm-clients';
import { syncCrmDeals } from '@/lib/sync/crm-deals';
import { syncOnboardingCalls } from '@/lib/sync/onboarding-calls';
import { syncPayoutHours } from '@/lib/sync/payout-hours';
import { syncProvisionPending } from '@/lib/sync/provision-pending';
import type { SyncFn } from '@/lib/sync/runner';
import { syncRoutingExport } from '@/lib/sync/routing-export';
import { syncScenarioAudit } from '@/lib/sync/scenario-audit';
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
  'payout-hours': {
    name: 'payout-hours',
    description:
      'Hubstaff tracked time plus approved paid leave into fortnightly payout ' +
      'lines — needs HUBSTAFF_TOKEN once, as a seed; the live token then lives ' +
      'in oauth_tokens because Hubstaff rotates it on every use',
    run: syncPayoutHours,
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
  'routing-export': {
    name: 'routing-export',
    description:
      'Publishes verified clinic-to-sheet routing into the Make data store, so ' +
      'no scenario has to name a spreadsheet — needs MAKE_TOKEN and ' +
      'MAKE_ROUTING_DATA_STORE_ID',
    run: syncRoutingExport,
  },
  'scenario-audit': {
    name: 'scenario-audit',
    description:
      'Where every Make booking scenario actually writes, and which of them ' +
      'address a sheet belonging to a different practice — needs MAKE_TOKEN',
    run: syncScenarioAudit,
  },
  'appointment-ledger': {
    name: 'appointment-ledger',
    description:
      'One row per appointment, reconciled across both feeds — and the daily ' +
      'exception list that comes out of it',
    run: syncAppointmentLedger,
  },
};

/** Not written yet. Named so that nothing looks finished when it is not. */
export const PLANNED_SYNCS: readonly string[] = [];

export function findSync(name: string): SyncDefinition | null {
  return SYNCS[name] ?? null;
}
