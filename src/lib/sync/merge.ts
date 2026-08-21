/**
 * The two merge rules every sync obeys.
 *
 * An API that has forgotten a value sends null. A human who typed a value
 * expects it to still be there tomorrow. So:
 *
 *   authoritative  the integration owns this field, but a null from the API
 *                  never lands — an absent value means "no news", not "empty"
 *   humanOwned     a person may have typed this. Fill it while it is empty;
 *                  once populated, the sync leaves it alone forever
 *
 * Getting this wrong is silent: nobody notices a wiped job value until the
 * month's revenue is short.
 */

function isMeaningful(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

function isEmpty(value: unknown): boolean {
  return !isMeaningful(value);
}

/**
 * Fields the integration owns. Copies incoming values, skipping any that are
 * null, undefined or blank.
 */
export function authoritative<Row extends object>(
  incoming: Partial<Row>,
  keys: ReadonlyArray<keyof Row>,
): Partial<Row> {
  const patch: Partial<Row> = {};
  for (const key of keys) {
    if (isMeaningful(incoming[key])) {
      patch[key] = incoming[key];
    }
  }
  return patch;
}

/**
 * Fields a human may own. Writes only where the stored value is still empty.
 * `emptyWhen` lets a column whose "empty" is a default rather than null — say
 * outcome = 'pending' — take part.
 */
export function humanOwned<Row extends object>(
  existing: Row,
  incoming: Partial<Row>,
  keys: ReadonlyArray<keyof Row>,
  emptyWhen: Partial<Record<keyof Row, (value: unknown) => boolean>> = {},
): Partial<Row> {
  const patch: Partial<Row> = {};
  for (const key of keys) {
    if (!isMeaningful(incoming[key])) continue;

    const test = emptyWhen[key] ?? isEmpty;
    if (test(existing[key])) {
      patch[key] = incoming[key];
    }
  }
  return patch;
}

/** True when a patch would change nothing, so the sync can count it skipped. */
export function isNoop<Row extends object>(
  existing: Row,
  patch: Partial<Row>,
): boolean {
  return Object.entries(patch).every(
    ([key, value]) => existing[key as keyof Row] === value,
  );
}
