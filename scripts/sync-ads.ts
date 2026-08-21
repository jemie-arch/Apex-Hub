/**
 * Run the ad sync from a terminal:
 *
 *   npm run sync:ads
 *
 * Same function the cron route and the settings button call.
 */
import 'dotenv/config';

import { runSync } from '../src/lib/sync/runner';
import { syncWindsorAds } from '../src/lib/sync/windsor-ads';

async function main(): Promise<void> {
  const result = await runSync('windsor-ads', 'cli', syncWindsorAds);

  console.log(
    `\nwindsor-ads: ${result.status} in ${result.durationMs}ms\n` +
      `  read ${result.counts.read} · created ${result.counts.created} · ` +
      `updated ${result.counts.updated} · skipped ${result.counts.skipped}`,
  );

  for (const error of result.errors.slice(0, 10)) {
    console.error(`  ! ${error.message}`);
  }

  process.exit(result.status === 'error' ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
