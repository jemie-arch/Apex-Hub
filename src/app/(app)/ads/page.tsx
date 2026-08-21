import { Megaphone } from 'lucide-react';
import Link from 'next/link';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import { formatCount, formatMoney } from '@/lib/format';
import { dateBounds, resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Ads' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Meta's status strings, mapped to a tone. */
function statusTone(status: string | null) {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'positive' as const;
    case 'PAUSED':
    case 'ADSET_PAUSED':
    case 'CAMPAIGN_PAUSED':
      return 'warning' as const;
    case 'DELETED':
    case 'ARCHIVED':
      return 'neutral' as const;
    default:
      return 'neutral' as const;
  }
}

export default async function AdsPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();
  const { start, end } = dateBounds(range.from, range.to);

  const [groups, locations, campaigns, ads, insights] = await Promise.all([
    db.from('client_groups').select('id, name, currency').order('name'),
    db.from('clients').select('id, name, group_id'),
    db.from('campaigns').select('id, client_id, name, status, external_id'),
    db.from('ads').select('id, client_id, campaign_id, name, status'),
    db
      .from('ad_level_insights')
      .select('ad_id, spend_cents, clicks')
      .gte('insight_on', start)
      .lte('insight_on', end),
  ]);

  if (groups.error) throw groups.error;
  if (locations.error) throw locations.error;
  if (campaigns.error) throw campaigns.error;
  if (ads.error) throw ads.error;
  if (insights.error) throw insights.error;

  const spendByAd = new Map<string, { spendCents: number; clicks: number }>();
  for (const row of insights.data ?? []) {
    const entry = spendByAd.get(row.ad_id) ?? { spendCents: 0, clicks: 0 };
    entry.spendCents += row.spend_cents;
    entry.clicks += row.clicks;
    spendByAd.set(row.ad_id, entry);
  }

  const locationsByGroup = new Map<string, typeof locations.data>();
  for (const row of locations.data ?? []) {
    const list = locationsByGroup.get(row.group_id) ?? [];
    list.push(row);
    locationsByGroup.set(row.group_id, list);
  }

  const client = tenant.vocabulary.client;

  // Only businesses that actually have campaigns; an empty accordion for every
  // client would bury the ones that matter.
  const withAds = (groups.data ?? []).filter((group) =>
    (locationsByGroup.get(group.id) ?? []).some((location) =>
      (campaigns.data ?? []).some((c) => c.client_id === location.id),
    ),
  );

  return (
    <>
      <PageHeader
        title="Ads"
        description={`Grouped by ${client.singular}, then campaign · ${range.label}`}
        actions={<DateRangePicker />}
      />

      {withAds.length === 0 ? (
        <EmptyState
          title="No campaigns synced"
          description={
            'Set WINDSOR_API_KEY, map ad account ids onto locations, then run ' +
            'windsor-ads from settings.'
          }
          icon={<Megaphone size={22} />}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {withAds.map((group) => {
            const groupLocations = locationsByGroup.get(group.id) ?? [];
            const locationIds = new Set(groupLocations.map((l) => l.id));
            const groupCampaigns = (campaigns.data ?? []).filter((c) =>
              locationIds.has(c.client_id),
            );

            const groupSpend = (ads.data ?? [])
              .filter((ad) => locationIds.has(ad.client_id))
              .reduce(
                (total, ad) => total + (spendByAd.get(ad.id)?.spendCents ?? 0),
                0,
              );

            return (
              <section
                key={group.id}
                className="overflow-hidden rounded-lg border border-line bg-surface"
              >
                <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-4 py-3">
                  <Link
                    href={`/clients/${group.id}`}
                    className="text-sm font-semibold text-fg hover:text-accent"
                  >
                    {group.name}
                  </Link>
                  <span className="numeric text-xs text-fg-subtle">
                    {formatCount(groupCampaigns.length)} campaigns ·{' '}
                    {formatMoney(groupSpend, group.currency)}
                  </span>
                </header>

                <div className="divide-y divide-line">
                  {groupCampaigns.map((campaign) => {
                    const campaignAds = (ads.data ?? []).filter(
                      (ad) => ad.campaign_id === campaign.id,
                    );
                    const campaignSpend = campaignAds.reduce(
                      (total, ad) =>
                        total + (spendByAd.get(ad.id)?.spendCents ?? 0),
                      0,
                    );

                    return (
                      <div key={campaign.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-fg">
                            {campaign.name}
                          </span>
                          <span className="flex items-center gap-2">
                            <StatusPill
                              value={campaign.status ?? 'unknown'}
                              tone={statusTone(campaign.status)}
                            />
                            <span className="numeric text-xs text-fg-subtle">
                              {formatMoney(campaignSpend, group.currency)}
                            </span>
                          </span>
                        </div>

                        {campaignAds.length === 0 ? (
                          <p className="mt-1.5 text-xs text-fg-subtle">
                            No ads synced under this campaign.
                          </p>
                        ) : (
                          <ul className="mt-2 flex flex-col gap-1">
                            {campaignAds.map((ad) => {
                              const spend = spendByAd.get(ad.id);
                              return (
                                <li
                                  key={ad.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-sunken px-2.5 py-1.5"
                                >
                                  <span className="text-xs text-fg">{ad.name}</span>
                                  <span className="numeric text-xs text-fg-subtle">
                                    {formatMoney(
                                      spend?.spendCents ?? 0,
                                      group.currency,
                                    )}{' '}
                                    · {formatCount(spend?.clicks ?? 0)} clicks
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-fg-subtle">
        Read-only. Campaigns are managed in the ad platform —{' '}
        {titleCase(tenant.company.name)} keeps this view for reporting, not
        editing.
      </p>
    </>
  );
}
