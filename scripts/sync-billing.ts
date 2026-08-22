/**
 * Run the Stripe billing sync from a terminal:
 *
 *   npm run sync:billing
 *
 * Same function the cron route and the Run now button call. Useful by hand
 * because this is the sync you want to run the moment somebody asks "did that
 * client actually pay?".
 */
import 'dotenv/config';

import { syncStripeCharges } from '../src/lib/sync/stripe-charges';
import { runSync } from '../src/lib/sync/runner';

async function main(): Promise<void> {
  const result = await runSync('stripe-charges', 'cli', syncStripeCharges);

  console.log(
    `\nstripe-charges: ${result.status} in ${result.durationMs}ms\n` +
      `  read ${result.counts.read} · created ${result.counts.created} · ` +
      `updated ${result.counts.updated} · skipped ${result.counts.skipped}`,
  );

  for (const error of result.errors.slice(0, 10)) {
    console.error(`  ! ${error.message}`);
  }

  // 'partial' is the normal outcome when charges have been declined — the sync
  // worked, it just has something to report. Only a genuine failure exits 1.
  process.exit(result.status === 'error' ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
