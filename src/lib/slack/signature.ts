/**
 * Verifying that a request really came from Slack.
 *
 * This is the only thing standing between the ticket table and the open
 * internet. The events endpoint cannot be protected the way every other machine
 * route here is: SERVICE_API_KEY works because Make can set an Authorization
 * header, and Slack cannot — the request URL is configured once in the app
 * manifest and Slack decides what it sends. So the URL is public and the
 * signature is the authentication.
 *
 * Slack signs `v0:<timestamp>:<raw body>` with the app's signing secret and
 * sends the result as `X-Slack-Signature: v0=<hex>`, with the same timestamp in
 * `X-Slack-Request-Timestamp`.
 *
 * THE RAW BODY MATTERS. The signature covers the exact bytes Slack sent, so the
 * route must read `await request.text()` and parse the JSON from that string.
 * Calling `request.json()` first and re-serialising produces a different byte
 * sequence — key order, whitespace, unicode escaping — and every request fails
 * with a mismatch that looks exactly like a wrong secret.
 *
 * The timestamp check is not decoration either. Without it a captured request
 * stays valid forever, and Slack payloads travel through whatever logs and
 * proxies sit in front of the function. Five minutes is Slack's own
 * recommendation.
 *
 * Kept free of next/server, node fetch and the environment so it can be
 * exercised by `npm run check:slack` without any of them.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Slack's recommendation, and the window a replayed request stays usable for. */
export const MAX_SKEW_SECONDS = 60 * 5;

export type SignatureFailure =
  | 'missing_headers'
  | 'malformed_timestamp'
  | 'stale_timestamp'
  | 'unsupported_version'
  | 'mismatch';

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: SignatureFailure };

export interface SignatureInput {
  /** The raw request body, exactly as received. Never a re-serialised object. */
  body: string;
  /** X-Slack-Request-Timestamp. */
  timestamp: string | null;
  /** X-Slack-Signature, including the `v0=` prefix. */
  signature: string | null;
  /** SLACK_SIGNING_SECRET. */
  secret: string;
  /** Seconds since the epoch. A parameter so the skew check is testable. */
  nowSeconds: number;
}

/**
 * Constant-time hex comparison.
 *
 * timingSafeEqual throws when the buffers differ in length, which is why the
 * length is checked first. That leaks the length of a signature whose length is
 * fixed and public anyway — v0= plus 64 hex characters, always.
 */
function sameDigest(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Is this request signed by the app that owns `secret`, and recent enough?
 *
 * Returns a named reason rather than a bare false. "Stale" and "mismatch" send
 * somebody to completely different places — a clock drift on the function host
 * versus a secret pasted from the wrong app — and the route answers 401 for
 * both, so the distinction only survives if it is carried out of here.
 */
export function verifySlackSignature(input: SignatureInput): SignatureResult {
  const { body, timestamp, signature, secret, nowSeconds } = input;

  if (!timestamp || !signature) return { ok: false, reason: 'missing_headers' };

  // Slack sends whole seconds. Anything non-numeric is not a truncated
  // timestamp to be salvaged, it is a request that did not come from Slack.
  if (!/^\d+$/.test(timestamp.trim())) {
    return { ok: false, reason: 'malformed_timestamp' };
  }

  const sent = Number.parseInt(timestamp.trim(), 10);
  if (Math.abs(nowSeconds - sent) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  // Only v0 exists today. A future version would need its own base string, so
  // accepting an unknown one by computing v0 over it would be a way to be
  // wrong quietly.
  if (!signature.startsWith('v0=')) {
    return { ok: false, reason: 'unsupported_version' };
  }

  const expected =
    'v0=' +
    createHmac('sha256', secret)
      .update(`v0:${timestamp.trim()}:${body}`)
      .digest('hex');

  return sameDigest(signature, expected)
    ? { ok: true }
    : { ok: false, reason: 'mismatch' };
}

/**
 * The signature a given body and timestamp should carry.
 *
 * Exported for the check script, which needs to produce a valid signature
 * without a Slack workspace. Nothing in the app calls it.
 */
export function signSlackRequest(
  body: string,
  timestamp: string,
  secret: string,
): string {
  return (
    'v0=' +
    createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
  );
}
