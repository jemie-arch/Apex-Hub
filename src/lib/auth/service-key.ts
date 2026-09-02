/**
 * Checking the SERVICE_API_KEY on a machine-to-machine request.
 *
 * One copy, used by every route that accepts this key. There were three
 * identical copies — /api/tokens/ghl, /api/webhooks/consultation-outcome and
 * /api/webhooks/onboarding-form — which is three places to fix a mistake in and
 * two chances to miss one.
 *
 * WHY THE PREFIX IS OPTIONAL
 *
 * The original required `Authorization: Bearer <key>` exactly, and rejected
 * anything else before comparing. That is the conventional shape and it cost a
 * day.
 *
 * Make's API Key Auth keychain has no separate prefix field. It has one "Key"
 * box, and its own help text says to type the prefix into it: "Enter the full
 * API key, including any required prefix… For example, Bearer, Token, or
 * APIKey." So whether the word and its single space are present depends on
 * somebody typing them into a masked field they cannot read back — and getting
 * it wrong produces `Authorization: <key>`, which failed the startsWith check
 * and returned 401. Indistinguishable, from the outside, from a wrong key.
 *
 * That failure mode is not worth defending. Accepting a bare key is no weaker:
 * the secret is still required in full, still compared in constant time, still
 * only over the Authorization header. What is dropped is a formatting demand
 * that carried no security and one silent way to be wrong.
 *
 * The scheme is matched case-insensitively for the same reason — `bearer` from
 * a sender that lowercases headers is not an attack, it is a typo we can absorb.
 */
import type { NextRequest } from 'next/server';

import { serviceApiKey } from '@/lib/env';

/**
 * Constant-time string comparison.
 *
 * Length is compared first and returns early, which leaks the length of the
 * expected key. That is the behaviour the three original copies had and it is
 * kept deliberately: the key is 32+ random characters, so knowing its length
 * buys an attacker nothing, and the alternative is a fixed-cost compare that is
 * easy to get subtly wrong.
 */
function sameSecret(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;

  let mismatch = 0;
  for (let index = 0; index < provided.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

/**
 * Does this Authorization header carry the expected secret?
 *
 * Exported separately from the request check so it can be tested without an
 * environment, a server or a secret — the prefix handling is the part that
 * caused a day's confusion, and it deserves assertions rather than trust.
 */
export function headerMatches(
  header: string | null,
  expected: string,
): boolean {
  if (!header) return false;

  const trimmed = header.trim();
  const provided = /^bearer\s+/i.test(trimmed)
    ? trimmed.replace(/^bearer\s+/i, '')
    : trimmed;

  return sameSecret(provided, expected);
}

/**
 * Is this request carrying the service key?
 *
 * Throws if SERVICE_API_KEY is unset, so a caller can answer 503 rather than a
 * bare 401 — "not configured" and "wrong key" send somebody to different
 * places, and conflating them is how an afternoon disappears.
 */
export function authorisedByServiceKey(request: NextRequest): boolean {
  return headerMatches(
    request.headers.get('authorization'),
    serviceApiKey(),
  );
}
