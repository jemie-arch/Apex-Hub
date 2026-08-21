/**
 * Run the CRM syncs from a terminal:
 *
 *   npm run sync:crm                  both, in order
 *   npm run sync:crm -- crm-clients   just one
 *
 * Deliberately the same functions the cron route calls. When a sync breaks at
 * 3am this is how you re-run it and watch what it does.
 *
 * Relative imports rather than @/ aliases: this runs under tsx, outside the
 * Next resolver.
 */
import 'dotenv/config';

import { syncCrmAppointments } from '../src/lib/sync/crm-appointments';
import { syncCrmClients } from '../src/lib/sync/crm-clients';
import { runSync, type SyncFn } from '../src/lib/sync/runner';

const ORDER: Array<{ name: string; run: SyncFn }> = [
  // Clients first: appointments hang off them.
  { name: 'crm-clients', run: syncCrmClients },
  { name: 'crm-appointments', run: syncCrmAppointments },
];

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const selected =
    only.length > 0 ? ORDER.filter((entry) => only.includes(entry.name)) : ORDER;

  if (selected.length === 0) {
    console.error(
      `Unknown sync. Available: ${ORDER.map((entry) => entry.name).join(', ')}`,
    );
    process.exit(1);
  }

  let failed = false;

  for (const entry of selected) {
    const result = await runSync(entry.name, 'cli', entry.run);

    console.log(
      `\n${entry.name}: ${result.status} in ${result.durationMs}ms\n` +
        `  read ${result.counts.read} · created ${result.counts.created} · ` +
        `updated ${result.counts.updated} · skipped ${result.counts.skipped}`,
    );

    for (const error of result.errors.slice(0, 10)) {
      console.error(`  ! ${error.message}`);
    }

    if (result.status === 'error') failed = true;
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
