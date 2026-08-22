/**
 * Stripe, read-only.
 *
 * This module never writes. It exists to answer one question — "was this
 * consult actually charged?" — which nothing else in the stack can answer:
 * GoHighLevel holds no record of Apex billing its clients, and the spreadsheet
 * only knows what was *supposed* to be billed.
 *
 * The key is a restricted key (rk_…) with read scopes only. A secret key would
 * work and is deliberately rejected in env.ts: nothing here needs write access,
 * so nothing here should hold it.
 *
 * Payment intents rather than charges or invoices, because a declined card
 * frequently never becomes either. `requires_payment_method` with a
 * `last_payment_error` attached is the shape a failed autocharge takes, and it
 * is invisible if you only read invoices.
 */
import { stripeCredentials } from '@/lib/env';

const API_BASE = 'https://api.stripe.com/v1';

/** Pinned so a Stripe API upgrade cannot silently reshape these payloads. */
const API_VERSION = '2024-06-20';

/** Stripe's hard cap. Asking for more is an error, not a bigger page. */
const PAGE_SIZE = 100;

/**
 * Our answer to "was it charged?", which is coarser than Stripe's status on
 * purpose — but only where the distinction carries no meaning for billing.
 */
export type BillingOutcome = 'succeeded' | 'failed' | 'pending' | 'canceled';

export interface StripeCharge {
  paymentIntentId: string;
  customerId: string | null;
  amountCents: number;
  currency: string;
  outcome: BillingOutcome;
  /** Stripe's own wording, kept because 'requires_payment_method' is specific. */
  stripeStatus: string;
  errorCode: string | null;
  declineCode: string | null;
  errorMessage: string | null;
  description: string | null;
  /** Patient names parsed from an "[ADM] Consults charged:" description. */
  consultNames: string[];
  invoiceId: string | null;
  occurredAt: string;
}

export interface StripeCustomer {
  customerId: string;
  name: string | null;
  email: string | null;
}

interface StripeListResponse<T> {
  data?: T[];
  has_more?: boolean;
}

interface RawPaymentIntent {
  id?: unknown;
  customer?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  description?: unknown;
  invoice?: unknown;
  created?: unknown;
  last_payment_error?: {
    code?: unknown;
    decline_code?: unknown;
    message?: unknown;
  } | null;
}

interface RawCustomer {
  id?: unknown;
  name?: unknown;
  email?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : 0;
}

/**
 * Stripe's status, narrowed to whether money moved.
 *
 * The subtlety is `requires_payment_method`. It means two different things: a
 * payment intent that has not been attempted yet, and one whose card was
 * declined. Only the presence of `last_payment_error` separates them, and
 * conflating the two would report every fresh intent as a failure.
 */
function classify(status: string, hasError: boolean): BillingOutcome {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'canceled') return 'canceled';
  if (status === 'requires_payment_method') return hasError ? 'failed' : 'pending';
  return 'pending';
}

/**
 * Pulls the patient names out of an Apex consult charge description.
 *
 * The descriptions look like:
 *
 *   [ADM]
 *
 *   Consults charged:
 *   Colie Jean -
 *   Ashlee Perkins -
 *
 * The trailing hyphens, blank lines and stray whitespace are all present in
 * real data, and the number of names is what the amount is derived from — so
 * this is the only way to tell *which* consults a failed charge covered.
 *
 * Returns an empty array for anything that is not an [ADM] consult charge
 * (subscription updates and manual invoices, which carry no patient names).
 */
export function parseConsultNames(description: string | null): string[] {
  if (!description) return [];

  const marker = description.indexOf('Consults charged:');
  if (marker === -1) return [];

  return description
    .slice(marker + 'Consults charged:'.length)
    .split('\n')
    .map((line) => line.replace(/[-–—\s]+$/, '').trim())
    .filter((line) => line !== '' && line !== '[ADM]');
}

async function get<T>(path: string): Promise<T> {
  const { apiKey } = stripeCredentials();

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'stripe-version': API_VERSION,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text();
    // Named explicitly: a restricted key missing one scope returns 403 with a
    // message naming the scope, and that message is the whole diagnosis.
    throw new Error(
      `Stripe ${path} responded ${response.status}: ${body.slice(0, 400)}`,
    );
  }

  return (await response.json()) as T;
}

/**
 * Every payment intent created on or after `since`, oldest page last.
 *
 * Paginated with `starting_after` rather than by date window, because two
 * intents can share a created timestamp and a date-based cursor would either
 * skip or repeat them.
 */
export async function listCharges(since: Date): Promise<StripeCharge[]> {
  const createdGte = Math.floor(since.getTime() / 1000);
  const out: StripeCharge[] = [];

  let cursor: string | null = null;

  // Bounded so a pagination bug cannot spin forever against a paid API.
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({
      limit: String(PAGE_SIZE),
      'created[gte]': String(createdGte),
    });
    if (cursor) query.set('starting_after', cursor);

    const body = await get<StripeListResponse<RawPaymentIntent>>(
      `/payment_intents?${query.toString()}`,
    );

    const rows = body.data ?? [];
    for (const row of rows) {
      const id = text(row.id);
      const created = integer(row.created);
      if (!id || created === 0) continue;

      const status = text(row.status) ?? 'unknown';
      const error = row.last_payment_error ?? null;
      const errorCode = text(error?.code);
      const errorMessage = text(error?.message);
      const hasError = errorCode !== null || errorMessage !== null;
      const description = text(row.description);

      out.push({
        paymentIntentId: id,
        customerId: text(row.customer),
        amountCents: integer(row.amount),
        currency: text(row.currency) ?? 'usd',
        outcome: classify(status, hasError),
        stripeStatus: status,
        errorCode,
        declineCode: text(error?.decline_code),
        errorMessage,
        description,
        consultNames: parseConsultNames(description),
        invoiceId: text(row.invoice),
        occurredAt: new Date(created * 1000).toISOString(),
      });
    }

    if (!body.has_more || rows.length === 0) break;

    const last = rows[rows.length - 1];
    const lastId = text(last?.id);
    if (!lastId) break;
    cursor = lastId;
  }

  return out;
}

/** One customer. Used to put a practice name against a charge. */
export async function getCustomer(
  customerId: string,
): Promise<StripeCustomer | null> {
  try {
    const row = await get<RawCustomer>(
      `/customers/${encodeURIComponent(customerId)}`,
    );
    const id = text(row.id);
    if (!id) return null;

    return { customerId: id, name: text(row.name), email: text(row.email) };
  } catch {
    // A deleted customer 404s. That is not a sync failure — the charge still
    // happened and is still worth recording.
    return null;
  }
}
