/**
 * Splits a list into fixed-size batches.
 *
 * Used to bound `.in(...)` lookups. PostgREST puts the whole list in the query
 * string, so a few hundred ids produce a URL long enough to be rejected with a
 * bare "Bad Request" — which says nothing about length being the problem.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');

  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/**
 * Ids per `.in(...)` lookup. Comfortably inside the URL limit even for long
 * CRM identifiers.
 */
export const ID_LOOKUP_BATCH = 100;
