import { BarChart3 } from 'lucide-react';

import { RecordAdDay } from '@/components/b2b-ads/RecordAdDay';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatMultiple,
  formatPercent,
} from '@/lib/format';
import { dateBounds, resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'B2B Ads Tracker' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface Totals {
  spendCents: number;
  impressions: number;
  clicks: number;
  leads: number;
  bookings: number;
  showed: number;
  qualifiedCalls: number;
  closed: number;
  cashCents: number;
}

const ZERO: Totals = {
  spendCents: 0,
  impressions: 0,
  clicks: 0,
  leads: 0,
  bookings: 0,
  showed: 0,
  qualifiedCalls: 0,
  closed: 0,
  cashCents: 0,
};

function add(a: Totals, b: Totals): Totals {
  return {
    spendCents: a.spendCents + b.spendCents,
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    leads: a.leads + b.leads,
    bookings: a.bookings + b.bookings,
    showed: a.showed + b.showed,
    qualifiedCalls: a.qualifiedCalls + b.qualifiedCalls,
    closed: a.closed + b.closed,
    cashCents: a.cashCents + b.cashCents,
  };
}

/**
 * A cost per something is undefined when the something is zero — not zero, and
 * not infinity. Returning null makes the table print an em dash instead of a
 * number that would read as "free".
 */
function per(spendCents: number, count: number): number | null {
  return count > 0 ? spendCents / count : null;
}

function rate(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

function money(value: number | null): string {
  return value === null ? '—' : formatMoney(Math.round(value));
}

function percent(value: number | null): string {
  return value === null ? '—' : formatPercent(value);
}

/**
 * Per-ad economics for the agency's own advertising.
 *
 * Every ratio here is computed at read time from the stored counts. None of
 * them is stored, because a stored ratio can end up disagreeing with the
 * numbers it came from.
 */
export default async function B2bAdsPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']) ?? 'last_30',
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const { start, end } = dateBounds(range.from, range.to);

  const days = await serviceClient()
    .from('b2b_ad_days')
    .select(
      'day, platform, campaign_name, ad_name, spend_cents, impressions, clicks, leads, bookings, showed, qualified_calls, closed, cash_collected_cents',
    )
    .gte('day', start)
    .lte('day', end)
    .order('day', { ascending: false })
    .limit(2000);

  if (days.error) throw days.error;

  const rows = days.data ?? [];

  // Roll the daily grain up to one row per ad; a day at a time is too fine to
  // read, and the ratios only mean anything over a few days anyway.
  const byAd = new Map<string, { label: string; campaign: string; totals: Totals }>();
  let overall = ZERO;

  for (const row of rows) {
    const key = `${row.platform}|${row.campaign_name}|${row.ad_name}`;
    const totals: Totals = {
      spendCents: row.spend_cents,
      impressions: row.impressions,
      clicks: row.clicks,
      leads: row.leads,
      bookings: row.bookings,
      showed: row.showed,
      qualifiedCalls: row.qualified_calls,
      closed: row.closed,
      cashCents: row.cash_collected_cents,
    };

    const existing = byAd.get(key);
    byAd.set(key, {
      label: row.ad_name,
      campaign: `${row.campaign_name} · ${row.platform}`,
      totals: existing ? add(existing.totals, totals) : totals,
    });

    overall = add(overall, totals);
  }

  const ads = [...byAd.values()].sort(
    (a, b) => b.totals.spendCents - a.totals.spendCents,
  );

  const roas =
    overall.spendCents > 0 ? overall.cashCents / overall.spendCents : null;

  return (
    <>
      <PageHeader
        title="B2B Ads Tracker"
        description={`What the agency's own advertising costs and returns · ${range.label}`}
        actions={
          <>
            <DateRangePicker />
            <RecordAdDay />
          </>
        }
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KPICard
          label="Spend"
          value={formatMoneyCompact(overall.spendCents)}
          higherIsBetter={false}
        />
        <KPICard
          label="Cost per lead"
          value={money(per(overall.spendCents, overall.leads))}
          higherIsBetter={false}
          hint={`${formatCount(overall.leads)} leads`}
        />
        <KPICard
          label="Cost per booking"
          value={money(per(overall.spendCents, overall.bookings))}
          higherIsBetter={false}
          hint={`${formatCount(overall.bookings)} booked`}
        />
        <KPICard
          label="Show rate"
          value={percent(rate(overall.showed, overall.bookings))}
          hint={`${formatCount(overall.showed)} showed`}
        />
        <KPICard
          label="ROAS"
          value={roas === null ? '—' : formatMultiple(roas)}
          hint={`${formatMoneyCompact(overall.cashCents)} collected`}
          hero
        />
      </section>

      {ads.length === 0 ? (
        <EmptyState
          title="Nothing recorded in this period"
          description={
            'This page tracks the agency buying its own leads, which is a ' +
            'separate ledger from client ad spend. Record a day to start it, ' +
            'or widen the date range.'
          }
          icon={<BarChart3 size={22} />}
          action={<RecordAdDay />}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Ad</th>
                  <th className="px-4 py-3 text-right font-medium">Spend</th>
                  <th className="px-4 py-3 text-right font-medium">Leads</th>
                  <th className="px-4 py-3 text-right font-medium">CPL</th>
                  <th className="px-4 py-3 text-right font-medium">Booked</th>
                  <th className="px-4 py-3 text-right font-medium">CPB</th>
                  <th className="px-4 py-3 text-right font-medium">Show rate</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Cost / qualified
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Closed</th>
                  <th className="px-4 py-3 text-right font-medium">Collected</th>
                  <th className="px-4 py-3 text-right font-medium">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((ad) => {
                  const t = ad.totals;
                  const adRoas =
                    t.spendCents > 0 ? t.cashCents / t.spendCents : null;

                  return (
                    <tr
                      key={`${ad.campaign}|${ad.label}`}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3">
                        <span className="block font-medium text-fg">
                          {ad.label}
                        </span>
                        <span className="block text-xs text-fg-subtle">
                          {ad.campaign}
                        </span>
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg">
                        {formatMoney(t.spendCents)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {formatCount(t.leads)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg">
                        {money(per(t.spendCents, t.leads))}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {formatCount(t.bookings)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg">
                        {money(per(t.spendCents, t.bookings))}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {percent(rate(t.showed, t.bookings))}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg">
                        {money(per(t.spendCents, t.qualifiedCalls))}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {formatCount(t.closed)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg">
                        {formatMoney(t.cashCents)}
                      </td>
                      <td
                        className={
                          adRoas !== null && adRoas >= 1
                            ? 'numeric px-4 py-3 text-right font-medium text-positive'
                            : 'numeric px-4 py-3 text-right text-fg-muted'
                        }
                      >
                        {adRoas === null ? '—' : formatMultiple(adRoas)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 max-w-2xl text-xs text-fg-subtle">
        A dash means the denominator was zero — no leads yet, so no cost per
        lead. That is different from a cost of nothing, which is why it is not
        printed as $0.00.
      </p>
    </>
  );
}
