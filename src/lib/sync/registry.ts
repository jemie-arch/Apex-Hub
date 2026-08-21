/**
 * The one list of syncs. The CLI scripts, the API route and vercel.json all
 * resolve through here, so a sync can never exist in the cron schedule but not
 * on the command line — which is exactly when you need to run it by hand.
 */
import { syncCrmAppointments } from '@/lib/sync/crm-appointments';
import { syncCrmClients } from '@/lib/sync/crm-clients';
import type { SyncFn } from '@/lib/sync/runner';
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
  'windsor-ads': {
    name: 'windsor-ads',
    description:
      'Windsor.ai daily ad spend — campaigns, ads, per-ad-day and the rollup',
    run: syncWindsorAds,
  },
};

/** Not written yet. Named so that nothing looks finished when it is not. */
export const PLANNED_SYNCS = ['crm-deals', 'calls'] as const;

export function findSync(name: string): SyncDefinition | null {
  return SYNCS[name] ?? null;
}
