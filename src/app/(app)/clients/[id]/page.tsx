import { ExternalLink, MapPin } from 'lucide-react';
import { notFound } from 'next/navigation';

import { BookingsTable, type BookingRow } from '@/components/clients/BookingsTable';
import { ClientEditor } from '@/components/clients/ClientEditor';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill, clientStatusTone } from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import {
  delta,
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatMultiple,
  formatPercent,
} from '@/lib/format';
import {
  conversionRate,
  costPerBookingCents,
  getDashboardMetrics,
  roas,
  showRate,
} from '@/lib/metrics';
import { bounds, dateBounds, resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Ads are grouped by NAME, not by id. A relaunched ad keeps its name under a
 * fresh external id, so grouping by id would list the same creative twice and
 * split its spend.
 */
interface AdRollup {
  name: string;
  variants: number;
  spendCents: number;
  impressions: number;
  clicks: number;
  metaLeads: number;
  costPerClickCents: number | null;
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();
  const { start, end } = bounds(range.from, range.to);
  const { start: dateStart, end: dateEnd } = dateBounds(range.from, range.to);

  const groupResult = await db
    .from('client_groups')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();

  if (groupResult.error) throw groupResult.error;
  if (!groupResult.data) notFound();

  const group = groupResult.data;

  const [locationsResult, otherGroupsResult, stageSetting] = await Promise.all([
    db.from('clients').select('*').eq('group_id', group.id).order('name'),
    // Merge targets for moving a sub-account onto another business.
    db
      .from('client_groups')
      .select('id, name')
      .neq('id', group.id)
      .order('name'),
    db
      .from('app_settings')
      .select('value')
      .eq('key', 'onboarding_stages')
      .maybeSingle(),
  ]);
  if (locationsResult.error) throw locationsResult.error;
  if (otherGroupsResult.error) throw otherGroupsResult.error;

  const stages: readonly string[] = Array.isArray(stageSetting.data?.value)
    ? (stageSetting.data.value as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : ['signed'];

  const locations = locationsResult.data ?? [];
  const locationIds = locations.map((row) => row.id);
  const locationById = new Map(locations.map((row) => [row.id, row]));

  const metrics = await getDashboardMetrics(range, group.id);

  // An empty locationIds list is fine: `in ()` matches nothing, which is the
  // right answer for a business with no sub-account linked yet. Running the
  // queries unconditionally keeps the result types exact.
  const [ads, insights, appointments] = await Promise.all([
    db.from('ads').select('id, name').in('client_id', locationIds),
    db
      .from('ad_level_insights')
      .select('ad_id, spend_cents, impressions, clicks, leads')
      .in('client_id', locationIds)
      .gte('insight_on', dateStart)
      .lte('insight_on', dateEnd),
    db
      .from('appointments')
      // One unbroken literal: Supabase infers row types from the select
      // string, and a concatenation is not a literal type, so splitting this
      // across lines with + collapses every field to GenericStringError.
      .select(
        'id, client_id, patient_name, patient_phone, address, scheduled_at, status, showed, outcome, value_cents, booked_by_name, attribution_source, utm_campaign, notes, reschedule_count',
      )
      .in('client_id', locationIds)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at', { ascending: false })
      .limit(300),
  ]);

  if (ads.error) throw ads.error;
  if (insights.error) throw insights.error;
  if (appointments.error) throw appointments.error;

  const adNameById = new Map((ads.data ?? []).map((row) => [row.id, row.name]));
  const byName = new Map<string, AdRollup>();
  const variantIds = new Map<string, Set<string>>();

  for (const row of insights.data ?? []) {
    const name = adNameById.get(row.ad_id);
    if (!name) continue;

    const rollup =
      byName.get(name) ??
      ({
        name,
        variants: 0,
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        metaLeads: 0,
        costPerClickCents: null,
      } satisfies AdRollup);

    rollup.spendCents += row.spend_cents;
    rollup.impressions += row.impressions;
    rollup.clicks += row.clicks;
    rollup.metaLeads += row.leads;
    byName.set(name, rollup);

    const ids = variantIds.get(name) ?? new Set<string>();
    ids.add(row.ad_id);
    variantIds.set(name, ids);
  }

  const adRollups = [...byName.values()]
    .map((rollup) => ({
      ...rollup,
      variants: variantIds.get(rollup.name)?.size ?? 1,
      costPerClickCents:
        rollup.clicks === 0
          ? null
          : Math.round(rollup.spendCents / rollup.clicks),
    }))
    .sort((a, b) => b.spendCents - a.spendCents);

  const bookingRows: BookingRow[] = (appointments.data ?? []).map((row) => {
    const owner = locationById.get(row.client_id);
    return {
      ...row,
      locationName: owner?.name ?? 'Unknown',
      // Falling back to the tenant default is a last resort; a location row
      // always carries a zone, so this only fires if one was just deleted.
      timezone: owner?.timezone ?? tenant.defaultTimezone,
    };
  });

  const { current, previous } = metrics;
  const booking = tenant.vocabulary.booking;
  const location = tenant.vocabulary.location;

  return (
    <>
      <PageHeader
        title={group.name}
        description={
          `${locations.length === 0 ? `No ${location.singular} linked` : locations.map((l) => l.name).join(' · ')}` +
          ` · ${range.label}`
        }
        actions={
          <>
            <StatusPill
              value={group.status}
              tone={clientStatusTone(group.status)}
            />
            <ClientEditor
              group={group}
              locations={locations}
              otherGroups={otherGroupsResult.data ?? []}
              stages={stages}
            />
            <DateRangePicker />
          </>
        }
      />

      {locations.length > 1 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {locations.map((row) => (
            <span
              key={row.id}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-fg-muted"
            >
              <MapPin size={12} />
              {row.name}
              <span className="text-fg-subtle">{row.timezone}</span>
              {row.is_active ? null : (
                <span className="text-warning">paused</span>
              )}
            </span>
          ))}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label={`${titleCase(booking.plural)} booked`}
          value={formatCount(current.booked)}
          delta={delta(current.booked, previous.booked)}
          hint={`${formatCount(current.awaitingOutcome)} awaiting an outcome`}
        />
        <KPICard
          label="Showed up"
          value={formatPercent(showRate(current), 0)}
          hint={`${formatCount(current.showed)} of ${formatCount(current.booked)}`}
        />
        <KPICard
          label="Converted"
          value={formatPercent(conversionRate(current), 0)}
          hint={`${formatMoneyCompact(current.revenueCents, group.currency)} won`}
        />
        <KPICard
          label="Return on ad spend"
          value={formatMultiple(roas(current))}
          hint={`${formatMoneyCompact(current.spendCents, group.currency)} spend`}
        />
      </section>

      <section className="mt-6 overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">Ad performance</h2>
          <span className="numeric text-xs text-fg-subtle">
            {formatMoney(current.spendCents, group.currency)} ·{' '}
            {formatCount(current.clicks)} clicks ·{' '}
            {formatMoney(costPerBookingCents(current), group.currency)} per{' '}
            {booking.singular}
          </span>
        </div>

        {adRollups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fg-muted">
            No ad activity in this period.
            {locations.some((l) => l.ad_account_id)
              ? ''
              : ` No ${location.singular} here has an ad account id set.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Ad</th>
                  <th className="px-4 py-3 text-right font-medium">Spend</th>
                  <th className="px-4 py-3 text-right font-medium">Impr.</th>
                  <th className="px-4 py-3 text-right font-medium">Clicks</th>
                  <th className="px-4 py-3 text-right font-medium">Meta leads</th>
                  <th className="px-4 py-3 text-right font-medium">Cost / click</th>
                </tr>
              </thead>
              <tbody>
                {adRollups.map((rollup) => (
                  <tr
                    key={rollup.name}
                    className="border-b border-line last:border-0 hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-fg">{rollup.name}</span>
                      {rollup.variants > 1 ? (
                        <span className="block text-xs text-fg-subtle">
                          {formatCount(rollup.variants)} relaunches combined
                        </span>
                      ) : null}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg">
                      {formatMoney(rollup.spendCents, group.currency)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatCount(rollup.impressions)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatCount(rollup.clicks)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatCount(rollup.metaLeads)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatMoney(rollup.costPerClickCents, group.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">
            {titleCase(booking.plural)}
          </h2>
          {group.portal_enabled ? (
            <a
              href={`/portal/${group.portal_token}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              Open portal <ExternalLink size={12} />
            </a>
          ) : null}
        </div>

        <BookingsTable
          rows={bookingRows}
          currency={group.currency}
          showLocation={locations.length > 1}
        />
      </section>
    </>
  );
}
