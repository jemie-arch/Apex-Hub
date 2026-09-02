/**
 * List a sub-account's custom values and map them against what we fill.
 *
 * Provisioning can only ever write a custom value the snapshot already
 * provides — setCustomValues fetches the location's fields and PUTs by id, and
 * creates nothing. So the snapshot's field list is the ceiling on what
 * onboarding can configure, and until now nobody had read that list; the gaps
 * were being discovered one at a time, in production, as `values_missing`.
 *
 * This prints the whole picture at once:
 *
 *   FILLED       we write it, and the field exists
 *   NOT FILLED   the field exists and nothing we collect maps to it
 *   MISSING      we would write it and the field does not exist
 *
 * The middle group is the useful one. It is the list of things the practice
 * could be asked for on the onboarding form and currently is not.
 *
 *   npx tsx scripts/list-custom-values.ts <crm_location_id>
 *
 * Needs the same credentials the app runs with, so run it where those are set.
 * It is read-only: one GET, no writes.
 */
import {
  CONSTANT_CUSTOM_VALUES,
  ONBOARDING_VALUE_MAP,
  derivedCustomValues,
  nameCustomValues,
} from '../src/config/provisioning';
import { listCustomValues } from '../src/lib/integrations/ghl-provision';
import { serviceClient } from '../src/lib/supabase/service';

async function main() {
  const locationId = process.argv[2];
  if (!locationId) {
    console.error(
      'Usage: npx tsx scripts/list-custom-values.ts <crm_location_id>\n' +
        'Any provisioned sub-account will do — the snapshot is the same for all.',
    );
    process.exit(1);
  }

  /*
   * The client id only decides which token is used. A location we know gets its
   * own token; one we do not falls back to the agency credential, which is the
   * case when inspecting a sub-account that was never registered in the Hub.
   */
  const match = await serviceClient()
    .from('clients')
    .select('id, name')
    .eq('crm_location_id', locationId)
    .maybeSingle();
  if (match.error) throw match.error;

  const live = await listCustomValues(match.data?.id ?? null, locationId);
  const present = new Map(live.map((value) => [value.name, value]));

  // Everything provisioning would write for a fully answered form.
  const weWrite = new Set<string>([
    ...Object.keys(CONSTANT_CUSTOM_VALUES),
    ...Object.values(ONBOARDING_VALUE_MAP),
    ...Object.keys(nameCustomValues('Example Practice')),
    ...Object.keys(derivedCustomValues('exampleLocationId', 'https://example.invalid')),
  ]);

  const sourceOf = new Map<string, string>();
  for (const key of Object.keys(CONSTANT_CUSTOM_VALUES)) sourceOf.set(key, 'constant');
  for (const [field, name] of Object.entries(ONBOARDING_VALUE_MAP)) {
    sourceOf.set(name, `form: ${field}`);
  }
  for (const key of Object.keys(nameCustomValues('Example Practice'))) {
    sourceOf.set(key, 'clinic name');
  }
  for (const key of Object.keys(derivedCustomValues('x', 'y'))) {
    sourceOf.set(key, 'derived after creation');
  }

  const filled: string[] = [];
  const notFilled: string[] = [];

  for (const name of [...present.keys()].sort((a, b) => a.localeCompare(b))) {
    (weWrite.has(name) ? filled : notFilled).push(name);
  }

  const missing = [...weWrite]
    .filter((name) => !present.has(name))
    .sort((a, b) => a.localeCompare(b));

  const line = (name: string, note?: string) =>
    console.log(`  ${name}${note ? `  <- ${note}` : ''}`);

  console.log(
    `\n${match.data?.name ?? 'Unregistered sub-account'} (${locationId})\n` +
      `${live.length} custom value(s) on the account, ${weWrite.size} that provisioning can fill.`,
  );

  console.log(`\nFILLED (${filled.length})`);
  filled.forEach((name) => line(name, sourceOf.get(name)));

  console.log(
    `\nNOT FILLED (${notFilled.length}) — the field exists and nothing we collect maps to it.` +
      '\nThis is the list worth reading: each one is a question the onboarding form could ask.',
  );
  notFilled.forEach((name) => line(name));

  console.log(
    `\nMISSING (${missing.length}) — we would write these and the snapshot has no such field.`,
  );
  missing.forEach((name) => line(name, sourceOf.get(name)));

  console.log('');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
