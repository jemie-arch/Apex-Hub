import { BarChart3 } from 'lucide-react';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { tenant, titleCase } from '@/config/tenant.config';
import {
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatMultiple,
  formatPercent,
} from '@/lib/format';
import { bounds, dateBounds, resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ad economics' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Per-ad economics, all the way to treatment value.
 *
 * This is the only page that joins the two halves of the business: spend comes
 * from the ad platform, and appointments come from the CRM, matched on the ad
 * id carried through on the contact. Grouped by ad NAME, because a relaunched
 * ad keeps its name under a new id and reporting it twice would halve both its
 * spend and its bookings.
 */
interface AdEconomics {
  name: string;
  clientName: string;
  currency: string;
  variants: number;
  spendCents: number;
  impressions: number;
  clicks: number;
  booked: number;
  showed: number;
  won: number;
  revenueCents: number;
}

export default async function AdsPerformancePage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();
  const { start, end } = bounds(range.from, range.to);
  const { start: dateStart, end: dateEnd } = dateBounds(range.from, range.to);

  const [groups, locations, ads, insights, appointments] = await Promise.all([
    db.from('client_groups').select('id, name, currency'),
    db.from('clients').select('id, group_id'),
    db.from('ads').select('id, client_id, external_id, name'),
    db
      .from('ad_level_insights')
      .select('ad_id, spend_cents, impressions, clicks')
      .gte('insight_on', dateStart)
      .lte('insight_on', dateEnd),
    db
      .from('appointments')
      .select('client_id, ad_external_id, showed, outcome, value_cents')
      .not('ad_external_id', 'is', null)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end),
  ]);

  if (groups.error) throw groups.error;
  if (locations.error) throw locations.error;
  if (ads.error) throw ads.error;
  if (insights.error) throw insights.error;
  if (appointments.error) throw appointments.error;

  const groupById = new Map((groups.data ?? []).map((row) => [row.id, row]));
  const groupIdByLocation = new Map(
    (locations.data ?? []).map((row) => [row.id, row.group_id]),
  );

  const adById = new Map((ads.data ?? []).map((row) => [row.id, row]));
  // external id -> ad name, so a CRM-side ad id can be resolved to a creative.
  const nameByExternal = new Map(
    (ads.data ?? []).map((row) => [row.external_id, row.name]),
  );

  // Key by client + ad name: the same creative name in two practices is two
  // rows, because their economics are separate.
  const table = new Map<string, AdEconomics>();
  const variantIds = new Map<string, Set<string>>();

  const keyFor = (groupId: string, name: string) => `${groupId}::${name}`;

  const ensure = (groupId: string, name: string): AdEconomics => {
    const key = keyFor(groupId, name);
    const existing = table.get(key);
    if (existing) return existing;

    const group = groupById.get(groupId);
    const fresh: AdEconomics = {
      name,
      clientName: group?.name ?? 'Unknown',
      currency: group?.currency ?? tenant.defaultCurrency,
      variants: 0,
      spendCents: 0,
      impressions: 0,
      clicks: 0,
      booked: 0,
      showed: 0,
      won: 0,
      revenueCents: 0,
    };
    table.set(key, fresh);
    return fresh;
  };

  for (const row of insights.data ?? []) {
    const ad = adById.get(row.ad_id);
    if (!ad) continue;
    const groupId = groupIdByLocation.get(ad.client_id);
    if (!groupId) continue;

    const entry = ensure(groupId, ad.name);
    entry.spendCents += row.spend_cents;
    entry.impressions += row.impressions;
    entry.clicks += row.clicks;

    const key = keyFor(groupId, ad.name);
    const ids = variantIds.get(key) ?? new Set<string>();
    ids.add(row.ad_id);
    variantIds.set(key, ids);
  }

  let unattributed = 0;

  for (const row of appointments.data ?? []) {
    const groupId = groupIdByLocation.get(row.client_id);
    if (!groupId || !row.ad_external_id) continue;

    const name = nameByExternal.get(row.ad_external_id);
    if (!name) {
      // The appointment names an ad we have never synced. Counted and
      // reported rather than folded into a creative it might not belong to.
      unattributed += 1;
      continue;
    }

    const entry = ensure(groupId, name);
    entry.booked += 1;
    if (row.showed === true) entry.showed += 1;
    if (row.outcome === 'won') {
      entry.won += 1;
      entry.revenueCents += row.value_cents ?? 0;
    }
  }

  const rows = [...table.entries()]
    .map(([key, entry]) => ({
      ...entry,
      variants: variantIds.get(key)?.size ?? 1,
    }))
    .sort((a, b) => b.spendCents - a.spendCents);

  const booking = tenant.vocabulary.booking;

  return (
    <>
      <PageHeader
        title={`${titleCase(booking.singular)} economics`}
        description={`Spend through to treatment value, per ad · ${range.label}`}
        actions={<DateRangePicker />}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          description={
            'This page needs both halves: ad spend from windsor-ads and ' +
            `${booking.plural} carrying an ad id from the CRM sync.`
          }
          icon={<BarChart3 size={22} />}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Ad</th>
                  <th className="px-4 py-3 text-right font-medium">Spend</th>
                  <th className="px-4 py-3 text-right font-medium">Clicks</th>
                  <th className="px-4 py-3 text-right font-medium">Booked</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Cost / {booking.singular}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Showed</th>
                  <th className="px-4 py-3 text-right font-medium">Won</th>
                  <th className="px-4 py-3 text-right font-medium">Revenue</th>
                  <th className="px-4 py-3 text-right font-medium">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const costPer =
                    row.booked === 0
                      ? null
                      : Math.round(row.spendCents / row.booked);
                  const returnOnSpend =
                    row.spendCents === 0
                      ? null
                      : row.revenueCents / row.spendCents;

                  return (
                    <tr
                      key={`${row.clientName}-${row.name}`}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-fg">{row.name}</span>
                        <span className="block text-xs text-fg-subtle">
                          {row.clientName}
                          {row.variants > 1
                            ? ` · ${formatCount(row.variants)} relaunches`
                            : ''}
                        </span>
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg">
                        {formatMoney(row.spendCents, row.currency)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {formatCount(row.clicks)}
                      </td>
                      <td className="numeric px-4 py-3 text-right font-medium text-fg">
                        {formatCount(row.booked)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {formatMoney(costPer, row.currency)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {formatPercent(
                          row.booked === 0 ? null : row.showed / row.booked,
                          0,
                        )}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {formatCount(row.won)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {formatMoneyCompact(row.revenueCents, row.currency)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {formatMultiple(returnOnSpend)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {unattributed > 0 ? (
        <p className="mt-4 text-xs text-warning">
          {formatCount(unattributed)} {booking.plural} reference an ad that has
          not been synced, so they are missing from the rows above. Run
          windsor-ads to pick up the creative.
        </p>
      ) : null}

      <p className="mt-2 text-xs text-fg-subtle">
        Revenue counts only appointments marked won with a value recorded, so
        ROAS understates until outcomes are entered in the portal.
      </p>
    </>
  );
}
