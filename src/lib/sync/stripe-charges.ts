/**
 * Stripe charge outcomes into billing_charges.
 *
 * This is the only place the app learns whether a consult was actually paid
 * for. Everything upstream — the tracker, the stat sheets, GoHighLevel — records
 * what *should* have been billed. Stripe is the only system that knows what was.
 *
 * Keyed on the payment intent id, so re-running is free and a retry of the same
 * consult lands as its own row. That matters: a practice whose card fails three
 * times has three rows, and the shape of that sequence is what tells you whether
 * the retry logic is carrying unpaid consults forward or dropping them.
 *
 * Deliberately does NOT reconcile against appointments. Matching a charge to an
 * appointment means matching on patient name, which is ambiguous enough that a
 * wrong match would be worse than no match. The page joins them for display and
 * says so; the stored data stays faithful to Stripe.
 */
import {
  getCustomer,
  listCharges,
  type BillingOutcome,
  type StripeCharge,
} from '@/lib/integrations/stripe';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/**
 * How far back to read on every run.
 *
 * Generous rather than incremental. Stripe charges are few — low hundreds a
 * quarter — so re-reading the window costs one API page or two and removes a
 * whole class of bug: an incremental cursor that drifts and silently stops
 * importing. The upsert makes repetition harmless.
 */
const WINDOW_DAYS = 120;

/** Strips punctuation and case so "Dr. Rushi Master" meets "Rushi Masters". */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface ClientRow {
  id: string;
  name: string;
  is_active: boolean;
}

/**
 * Best guess at which client a Stripe customer belongs to, or null.
 *
 * Returns null on ambiguity rather than picking one. Stripe customers are named
 * after the practice *owner* ("Zubad Newaz", "Vernyce Jones") far more often
 * than the practice, so most will not match anything — and a confident wrong
 * answer here would attribute one practice's failed charges to another. The page
 * surfaces the unmapped ones for a human to map once.
 */
function guessClient(
  customerName: string | null,
  clients: ClientRow[],
): string | null {
  if (!customerName) return null;

  const needle = normalise(customerName);
  if (needle.length < 4) return null;

  const hits = clients.filter((client) => {
    const hay = normalise(client.name);
    return hay.length >= 4 && (hay.includes(needle) || needle.includes(hay));
  });

  return hits.length === 1 ? hits[0]!.id : null;
}

/** Consumer mailboxes carry no signal about which practice this is. */
const GENERIC_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'aol.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'sbcglobal.net',
  'comcast.net',
  'me.com',
  'live.com',
  'msn.com',
]);

/**
 * Second attempt: match on the email domain.
 *
 * A practice mailbox is often the giveaway that the customer name is not —
 * `monica@airwayortho.com` identifies Airway Orthodontics even though the
 * customer is called "Zubad Newaz". Consumer domains are skipped because
 * "@gmail.com" says nothing, and a practice-shaped domain is only accepted when
 * exactly one client matches.
 *
 * Roughly half of Apex's Stripe customers use a personal mailbox, so this is a
 * useful boost and not a substitute for mapping the rest by hand.
 */
function guessClientByEmail(
  email: string | null,
  clients: ClientRow[],
): string | null {
  if (!email) return null;

  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain || GENERIC_DOMAINS.has(domain)) return null;

  // "airwayortho.com" -> "airwayortho"; drop the TLD and any punctuation.
  const stem = domain.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '');
  if (stem.length < 5) return null;

  const hits = clients.filter((client) => {
    const hay = normalise(client.name);
    return hay.length >= 5 && (hay.includes(stem) || stem.includes(hay));
  });

  return hits.length === 1 ? hits[0]!.id : null;
}

function isUncollected(outcome: BillingOutcome): boolean {
  return outcome === 'failed';
}

export async function syncStripeCharges(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const charges = await listCharges(since);
  ctx.counts.read = charges.length;
  ctx.log(`read ${charges.length} payment intent(s) since ${since.toISOString().slice(0, 10)}`);

  if (charges.length === 0) {
    ctx.note('window_days', WINDOW_DAYS);
    return;
  }

  // ---- customers -----------------------------------------------------------

  const customerIds = [
    ...new Set(charges.flatMap((c) => (c.customerId ? [c.customerId] : []))),
  ];

  const [known, clientRows] = await Promise.all([
    db
      .from('billing_customers')
      .select('stripe_customer_id, client_id, mapped_by_hand')
      .in('stripe_customer_id', customerIds.length > 0 ? customerIds : ['none']),
    db.from('clients').select('id, name, is_active'),
  ]);

  if (known.error) throw known.error;
  if (clientRows.error) throw clientRows.error;

  const clients = (clientRows.data ?? []) as ClientRow[];
  const existing = new Map(
    (known.data ?? []).map((row) => [row.stripe_customer_id, row]),
  );

  const clientByCustomer = new Map<string, string | null>();
  let unmapped = 0;

  for (const customerId of customerIds) {
    const prior = existing.get(customerId);

    // A mapping somebody confirmed by hand is never second-guessed by a fuzzy
    // name match on the next run.
    if (prior?.mapped_by_hand) {
      clientByCustomer.set(customerId, prior.client_id ?? null);
      if (!prior.client_id) unmapped += 1;
      continue;
    }

    const customer = await getCustomer(customerId);
    if (!customer) {
      ctx.counts.skipped += 1;
      clientByCustomer.set(customerId, prior?.client_id ?? null);
      continue;
    }

    const clientId =
      prior?.client_id ??
      guessClient(customer.name, clients) ??
      guessClientByEmail(customer.email, clients);
    clientByCustomer.set(customerId, clientId);
    if (!clientId) unmapped += 1;

    const saved = await db.from('billing_customers').upsert(
      {
        stripe_customer_id: customer.customerId,
        client_id: clientId,
        name: customer.name,
        email: customer.email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'stripe_customer_id' },
    );

    if (saved.error) {
      ctx.recordError(`could not save customer ${customerId}`, {
        detail: saved.error.message,
      });
    }
  }

  // ---- charges -------------------------------------------------------------

  const priorCharges = await db
    .from('billing_charges')
    .select('stripe_payment_intent_id')
    .gte('occurred_at', since.toISOString());

  if (priorCharges.error) throw priorCharges.error;

  const seen = new Set(
    (priorCharges.data ?? []).map((row) => row.stripe_payment_intent_id),
  );

  const rows = charges.map((charge: StripeCharge) => ({
    stripe_payment_intent_id: charge.paymentIntentId,
    stripe_customer_id: charge.customerId,
    client_id: charge.customerId
      ? (clientByCustomer.get(charge.customerId) ?? null)
      : null,
    amount_cents: charge.amountCents,
    currency: charge.currency,
    outcome: charge.outcome,
    stripe_status: charge.stripeStatus,
    error_code: charge.errorCode,
    decline_code: charge.declineCode,
    error_message: charge.errorMessage,
    description: charge.description,
    consult_names: charge.consultNames,
    consult_count: charge.consultNames.length,
    stripe_invoice_id: charge.invoiceId,
    occurred_at: charge.occurredAt,
    updated_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  }));

  // Chunked: a single statement with several hundred rows and an array column
  // is where PostgREST starts returning "Bad Request" with nothing useful in it.
  const CHUNK = 200;
  for (let index = 0; index < rows.length; index += CHUNK) {
    const slice = rows.slice(index, index + CHUNK);

    const written = await db
      .from('billing_charges')
      .upsert(slice, { onConflict: 'stripe_payment_intent_id' });

    if (written.error) {
      ctx.recordError(`could not save ${slice.length} charge(s)`, {
        detail: written.error.message,
        firstId: slice[0]?.stripe_payment_intent_id,
      });
      continue;
    }

    for (const row of slice) {
      if (seen.has(row.stripe_payment_intent_id)) ctx.counts.updated += 1;
      else ctx.counts.created += 1;
    }
  }

  // ---- what the run found -------------------------------------------------
  //
  // Written to sync_runs.meta rather than the log, because these are the
  // numbers somebody would otherwise have to go and derive by hand.

  const failed = charges.filter((c) => isUncollected(c.outcome));
  const uncollectedCents = failed.reduce((sum, c) => sum + c.amountCents, 0);

  ctx.note('window_days', WINDOW_DAYS);
  ctx.note('customers_seen', customerIds.length);
  ctx.note('customers_unmapped', unmapped);
  ctx.note('failed_charges', failed.length);
  ctx.note('uncollected_cents', uncollectedCents);

  if (failed.length > 0) {
    // A non-fatal error so the run reports 'partial' and the Slack alert fires.
    // A declined card is not a bug in this sync, but it is the thing the sync
    // exists to surface, and silence is how it went unnoticed for weeks.
    ctx.recordError(
      `${failed.length} charge(s) totalling ` +
        `$${(uncollectedCents / 100).toFixed(2)} were declined and remain uncollected`,
      { paymentIntents: failed.slice(0, 20).map((c) => c.paymentIntentId) },
    );
  }

  if (unmapped > 0) {
    ctx.log(
      `${unmapped} Stripe customer(s) are not mapped to a client — ` +
        'map them on /billing so their charges are attributed',
    );
  }
}
