/**
 * Authorisation for machine-triggered routes.
 *
 * Extracted so the per-sync route and the cycle dispatcher cannot drift apart:
 * two copies of a bearer check is how one of them ends up subtly weaker than
 * the other.
 */
import type { NextRequest } from 'next/server';

import { serverEnv } from '@/lib/env';

/**
 * True when the caller presented the cron secret.
 *
 * Compares in constant time. Overkill for a cron secret, but the work is free
 * and it removes the question.
 */
export function authorisedCron(request: NextRequest): boolean {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;

  const provided = header.slice('Bearer '.length);
  const expected = serverEnv().CRON_SECRET;

  if (provided.length !== expected.length) return false;

  let mismatch = 0;
  for (let index = 0; index < provided.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}
