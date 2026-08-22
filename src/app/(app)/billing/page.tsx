import { AlertTriangle, CreditCard, Link2Off } from 'lucide-react';
import Link from 'next/link';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import { formatCount, formatMoney, formatMoneyCompact, humanise } from '@/lib/format';
import { resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Billing' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type Outcome = 'succeeded' | 'failed' | 'pending' | 'canceled';

interface ChargeRow {
  stripe_payment_intent_id: string;
  stripe_customer_id: string | null;
  client_id: string | null;
  amount_cents: number;
  currency: string;
  outcome: Outcome;
  stripe_status: string;
  decline_code: string | null;
  error_message: string | null;
  consult_names: string[] | null;
  consult_count: number;
  occurred_at: string;
}

const TONES: Record<Outcome, Tone> = {
  succeeded: 'positive',
  failed: 'negative',
  pending: 'warning',
  canceled: 'neutral',
};

/** Stripe's wording, said the way a person would say it. */
function explain(row: ChargeRow): string {
  if (row.outcome === 'succeeded') return 'Collected';
  if (row.outcome === 'canceled') return 'Cancelled — usually superseded by another attempt';
  if (row.outcome === 'pending') return 'Awaiting a payment method — never attempted';
  if (row.decline_code) return `Declined — ${humanise(row.decline_code).toLowerCase()}`;
  return row.error_message ?? 'Declined';
}

interface ClientTotals {
  clientId: string | null;
  name: string;
  isActive: boolean;
  collectedCents: number;
  uncollectedCents: number;
  succeeded: number;
  failed: number;
  pending: number;
  consultsBilled: number;
  lastChargeAt: string | null;
}

/**
 * What Apex charged its clients, and what did not land.
 *
 * The distinction this page exists to make: an appointment can be missing a
 * charge for two completely different reasons. Either the card was declined —
 * which is here, in Stripe — or no charge was ever attempted, which shows up as
 * an active client with no rows at all. The second kind is the one nobody could
 * see before, so active clients with nothing against them are listed rather
 * than filtered out.
 */
export default async function BillingPage({ searchParams }: PageProps) {
  const range = resolveRange({
    // Billing runs on a monthly-ish cycle with retries trailing behind it, so a
    // 30-day window routinely cuts a retry off from the charge it belongs to.
    preset: single(searchParams['preset']) ?? 'last_90',
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();

  const [charges, clientRows, customers, lastRun] = await Promise.all([
    db
      .from('billing_charges')
      // One string literal, not a concatenation: Supabase infers the row type
      // from the literal, and a `+` here silently degrades every column to an
      // error type.
      .select(
        'stripe_payment_intent_id, stripe_customer_id, client_id, amount_cents, currency, outcome, stripe_status, decline_code, error_message, consult_names, consult_count, occurred_at',
      )
      .gte('occurred_at', range.from.toISOString())
      .lte('occurred_at', range.to.toISOString())
      .order('occurred_at', { ascending: false })
      .limit(1000),
    db.from('clients').select('id, name, is_active').order('name'),
    db
      .from('billing_customers')
      .select('stripe_customer_id, client_id, name, email'),
    db
      .from('sync_runs')
      .select('status, ended_at, meta')
      .eq('name', 'stripe-charges')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (charges.error) throw charges.error;
  if (clientRows.error) throw clientRows.error;
  if (customers.error) throw customers.error;

  const rows = (charges.data ?? []) as ChargeRow[];
  const clients = clientRows.data ?? [];
  const customerRows = customers.data ?? [];

  const customerName = new Map(
    customerRows.map((row) => [
      row.stripe_customer_id,
      row.name ?? row.email ?? row.stripe_customer_id,
    ]),
  );
  const unmapped = customerRows.filter((row) => !row.client_id);

  // ---- rollup -------------------------------------------------------------
  // Seeded with every client, including ones with no charges, because "this
  // active client has never been billed" is the finding, not an empty row.

  const totals = new Map<string, ClientTotals>();
  for (const client of clients) {
    totals.set(client.id, {
      clientId: client.id,
      name: client.name,
      isActive: client.is_active,
      collectedCents: 0,
      uncollectedCents: 0,
      succeeded: 0,
      failed: 0,
      pending: 0,
      consultsBilled: 0,
      lastChargeAt: null,
    });
  }

  const UNATTRIBUTED = '__unattributed__';
  totals.set(UNATTRIBUTED, {
    clientId: null,
    name: 'Not yet mapped to a client',
    isActive: true,
    collectedCents: 0,
    uncollectedCents: 0,
    succeeded: 0,
    failed: 0,
    pending: 0,
    consultsBilled: 0,
    lastChargeAt: null,
  });

  let collectedCents = 0;
  let uncollectedCents = 0;
  let pendingCents = 0;

  for (const row of rows) {
    const bucket = totals.get(row.client_id ?? UNATTRIBUTED);
    if (!bucket) continue;

    bucket.consultsBilled += row.consult_count;
    if (!bucket.lastChargeAt || row.occurred_at > bucket.lastChargeAt) {
      bucket.lastChargeAt = row.occurred_at;
    }

    if (row.outcome === 'succeeded') {
      bucket.succeeded += 1;
      bucket.collectedCents += row.amount_cents;
      collectedCents += row.amount_cents;
    } else if (row.outcome === 'failed') {
      bucket.failed += 1;
      bucket.uncollectedCents += row.amount_cents;
      uncollectedCents += row.amount_cents;
    } else if (row.outcome === 'pending') {
      bucket.pending += 1;
      pendingCents += row.amount_cents;
    }
  }

  const failedRows = rows.filter((row) => row.outcome === 'failed');

  const rollup = [...totals.values()]
    .filter((row) => row.succeeded + row.failed + row.pending > 0 || row.isActive)
    .sort((a, b) => {
      if (b.uncollectedCents !== a.uncollectedCents) {
        return b.uncollectedCents - a.uncollectedCents;
      }
      return b.collectedCents - a.collectedCents;
    });

  const neverBilled = rollup.filter(
    (row) => row.isActive && row.clientId !== null && row.succeeded + row.failed + row.pending === 0,
  );

  const client = tenant.vocabulary.client;
  const meta = (lastRun.data?.meta ?? {}) as Record<string, unknown>;
  const notConfigured = rows.length === 0 && !lastRun.data;

  /**
   * Whether "this client was never billed" is a claim we can actually make.
   *
   * It only holds once every Stripe customer is mapped to a client. While any
   * are unmapped their charges sit under "not yet mapped", so a client can look
   * unbilled when in fact it was billed under a customer nobody has matched up
   * yet. Showing the count anyway would be the same class of mistake this whole
   * page exists to catch, so it is withheld until the mapping is complete.
   */
  const mappingComplete = unmapped.length === 0;

  return (
    <>
      <PageHeader
        title="Billing"
        description={`Charges to ${client.plural} · ${range.label}`}
        actions={<DateRangePicker />}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard label="Collected" value={formatMoneyCompact(collectedCents)} />
        <KPICard
          label="Uncollected"
          value={formatMoneyCompact(uncollectedCents)}
          hint={`${formatCount(failedRows.length)} declined charge(s)`}
          higherIsBetter={false}
        />
        <KPICard
          label="Never attempted"
          value={formatMoneyCompact(pendingCents)}
          hint="awaiting a payment method"
          higherIsBetter={false}
        />
        {mappingComplete ? (
          <KPICard
            label={`Active ${client.plural} never billed`}
            value={formatCount(neverBilled.length)}
            hint="no charge in this period"
            higherIsBetter={false}
          />
        ) : (
          <KPICard
            label="Stripe customers unmapped"
            value={formatCount(unmapped.length)}
            hint="map these before trusting per-client totals"
            higherIsBetter={false}
          />
        )}
      </section>

      {notConfigured ? (
        <EmptyState
          title="The billing sync has not run yet"
          description={
            'Set STRIPE_RESTRICTED_KEY to a Stripe restricted key with read ' +
            'access to payment intents, then run stripe-charges from Settings. ' +
            'Until then this page has nothing to show — which is not the same ' +
            'as nothing being owed.'
          }
          icon={<CreditCard size={22} />}
        />
      ) : null}

      {unmapped.length > 0 ? (
        <section className="mb-6 rounded-lg border border-line bg-surface p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Link2Off size={14} /> {formatCount(unmapped.length)} Stripe customer(s)
            not mapped to a {client.singular}
          </h2>
          <p className="mt-1 text-xs text-fg-subtle">
            Stripe customers are usually named after the practice owner rather
            than the practice, so most cannot be matched automatically. Their
            charges are counted in the totals above but grouped under &ldquo;not
            yet mapped&rdquo; below.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {unmapped.slice(0, 20).map((row) => (
              <li
                key={row.stripe_customer_id}
                className="rounded-md border border-line bg-surface-sunk px-2 py-1 text-xs text-fg-muted"
              >
                {row.name ?? row.email ?? row.stripe_customer_id}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {failedRows.length > 0 ? (
        <section className="mb-6 overflow-hidden rounded-lg border border-negative bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-negative">
              <AlertTriangle size={14} /> Declined and still uncollected
            </h2>
            <p className="mt-0.5 text-xs text-fg-subtle">
              {formatMoney(uncollectedCents)} across{' '}
              {formatCount(failedRows.length)} charge(s). A later attempt may have
              collected some of this — check the sequence per {client.singular}{' '}
              before chasing.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Stripe customer</th>
                  <th className="px-4 py-3 font-medium">Why</th>
                  <th className="px-4 py-3 font-medium">Consults billed</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {failedRows.map((row) => (
                  <tr
                    key={row.stripe_payment_intent_id}
                    className="border-b border-line last:border-0"
                  >
                    <td className="numeric px-4 py-3 text-fg-muted">
                      {row.occurred_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-fg">
                      {row.stripe_customer_id
                        ? (customerName.get(row.stripe_customer_id) ??
                          row.stripe_customer_id)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-negative">{explain(row)}</td>
                    <td className="px-4 py-3 text-xs text-fg-subtle">
                      {row.consult_names && row.consult_names.length > 0
                        ? row.consult_names.join(', ')
                        : '—'}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg">
                      {formatMoney(row.amount_cents, row.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {rollup.length > 0 ? (
        <section className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-fg">
              Every active {client.singular}
            </h2>
            <p className="mt-0.5 text-xs text-fg-subtle">
              {mappingComplete
                ? `Including those with no charges at all — an active ${client.singular} with nothing here is either not on pay-per-appointment or is not being billed.`
                : `Per-${client.singular} totals are incomplete while ${formatCount(unmapped.length)} Stripe customer(s) are unmapped: their charges are grouped under “not yet mapped” rather than against the ${client.singular} that earned them.`}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">
                    {titleCase(client.singular)}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Collected</th>
                  <th className="px-4 py-3 text-right font-medium">Uncollected</th>
                  <th className="px-4 py-3 text-right font-medium">Succeeded</th>
                  <th className="px-4 py-3 text-right font-medium">Failed</th>
                  <th className="px-4 py-3 text-right font-medium">Consults</th>
                  <th className="px-4 py-3 font-medium">Last charge</th>
                </tr>
              </thead>
              <tbody>
                {rollup.map((row) => {
                  const silent = row.succeeded + row.failed + row.pending === 0;

                  return (
                    <tr
                      key={row.clientId ?? UNATTRIBUTED}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3">
                        {row.clientId ? (
                          <Link
                            href={`/clients/${row.clientId}`}
                            className="text-fg hover:text-accent"
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className="text-fg-muted">{row.name}</span>
                        )}
                        {!row.isActive ? (
                          <span className="ml-2 text-xs text-fg-subtle">paused</span>
                        ) : null}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-positive">
                        {row.collectedCents > 0
                          ? formatMoney(row.collectedCents)
                          : '—'}
                      </td>
                      <td className="numeric px-4 py-3 text-right">
                        {row.uncollectedCents > 0 ? (
                          <span className="text-negative">
                            {formatMoney(row.uncollectedCents)}
                          </span>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {row.succeeded || '—'}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {row.failed || '—'}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {row.consultsBilled || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {silent ? (
                          mappingComplete ? (
                            <StatusPill value="never billed" tone="warning" />
                          ) : (
                            <span className="text-xs text-fg-subtle">
                              unknown — customers unmapped
                            </span>
                          )
                        ) : (
                          <span className="numeric text-xs text-fg-muted">
                            {row.lastChargeAt?.slice(0, 10) ?? '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="mt-4 text-xs text-fg-subtle">
        Read from Stripe, keyed on the payment intent — re-running the sync
        cannot double-count.{' '}
        {lastRun.data ? (
          <>
            Last sync {humanise(lastRun.data.status)} at{' '}
            {lastRun.data.ended_at?.slice(0, 16).replace('T', ' ') ?? 'unknown'} UTC
            {typeof meta['customers_unmapped'] === 'number'
              ? ` · ${formatCount(meta['customers_unmapped'])} unmapped customer(s)`
              : ''}
            .
          </>
        ) : null}{' '}
        A charge missing here means the card was declined. An appointment missing a
        charge <em>entirely</em> is a different failure and will not appear on this
        page — that one shows up as an active {client.singular} with nothing
        against it.
      </p>
    </>
  );
}
