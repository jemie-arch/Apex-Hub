/**
 * Windsor.ai -> campaigns, ads, ad_level_insights, ad_snapshots.
 *
 * One sync rather than the two the Graph API needed. Windsor returns campaign
 * name, ad name and the day's metrics on every row, so structure and spend
 * arrive together — which removes the ordering trap where insights land for an
 * ad that has not been created yet.
 *
 * The window is rewritten in full on every run. Ad platforms keep revising
 * attributed numbers for days afterwards, and every table here has a unique
 * constraint on its grain, so re-writing corrects rather than duplicates.
 */
import { fetchAdRows, WINDSOR_CONNECTOR } from '@/lib/integrations/windsor';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

const PLATFORM = 'meta';

/** Days of history rewritten each run, including today. */
const WINDOW_DAYS = 7;

/** Accounts per request: one call for all 45 makes a timeout lose everything. */
const BATCH_SIZE = 10;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

interface DayMetrics {
  spendCents: number;
  impressions: number;
  clicks: number;
  leads: number;
  reach: number;
  frequency: number | null;
}

export async function syncWindsorAds(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  // Active sub-accounts with an ad account, whose business has not churned.
  const [clientRows, churnedGroups] = await Promise.all([
    db
      .from('clients')
      .select('id, name, group_id, ad_account_id')
      .not('ad_account_id', 'is', null)
      .eq('is_active', true),
    db.from('client_groups').select('id').eq('status', 'churned'),
  ]);
  if (clientRows.error) throw clientRows.error;
  if (churnedGroups.error) throw churnedGroups.error;

  const churned = new Set((churnedGroups.data ?? []).map((row) => row.id));
  const clients = {
    data: (clientRows.data ?? []).filter((row) => !churned.has(row.group_id)),
  };

  // Windsor reports account ids bare; tolerate an act_ prefix in our column.
  const clientByAccount = new Map<string, { id: string; name: string }>();
  for (const client of clients.data ?? []) {
    if (!client.ad_account_id) continue;
    const bare = client.ad_account_id.replace(/^act_/, '');
    clientByAccount.set(bare, { id: client.id, name: client.name });
  }

  if (clientByAccount.size === 0) {
    ctx.log(
      'no client has an ad_account_id set — nothing to pull. Map Windsor ' +
        'account ids onto clients first.',
    );
    return;
  }

  const dateTo = isoDate(new Date());
  const dateFrom = isoDate(new Date(Date.now() - (WINDOW_DAYS - 1) * 86_400_000));
  ctx.log(`window ${dateFrom} to ${dateTo} across ${clientByAccount.size} account(s)`);

  // Accumulated across every batch, then written once per table.
  const campaigns = new Map<
    string,
    { clientId: string; externalId: string; name: string }
  >();
  const ads = new Map<
    string,
    {
      clientId: string;
      externalId: string;
      name: string;
      campaignExternalId: string | null;
      adsetName: string | null;
    }
  >();
  const insights = new Map<
    string,
    { clientId: string; adExternalId: string; date: string; metrics: DayMetrics }
  >();
  const snapshots = new Map<
    string,
    { clientId: string; date: string; metrics: DayMetrics }
  >();

  const accountsWithData = new Set<string>();

  for (const batch of chunk([...clientByAccount.keys()], BATCH_SIZE)) {
    let rows;
    try {
      rows = await fetchAdRows(batch, dateFrom, dateTo);
    } catch (error) {
      // One batch failing must not lose the rest.
      ctx.recordError(`Windsor request failed for ${batch.length} account(s)`, {
        accounts: batch,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    ctx.counts.read += rows.length;

    for (const row of rows) {
      const client = clientByAccount.get(row.accountId);
      if (!client) {
        // Windsor returned an account we did not ask for; never guess an owner.
        ctx.counts.skipped += 1;
        continue;
      }

      accountsWithData.add(row.accountId);

      if (row.campaignExternalId && row.campaignName) {
        campaigns.set(`${PLATFORM}:${row.campaignExternalId}`, {
          clientId: client.id,
          externalId: row.campaignExternalId,
          name: row.campaignName,
        });
      }

      ads.set(`${PLATFORM}:${row.adExternalId}`, {
        clientId: client.id,
        externalId: row.adExternalId,
        // Relaunched ads reuse the name under a new id, so the name alone is
        // not an identity — external_id is.
        name: row.adName ?? row.adExternalId,
        campaignExternalId: row.campaignExternalId,
        adsetName: row.adsetName,
      });

      const insightKey = `${row.adExternalId}:${row.date}`;
      const existing = insights.get(insightKey);
      if (existing) {
        existing.metrics.spendCents += row.spendCents;
        existing.metrics.impressions += row.impressions;
        existing.metrics.clicks += row.clicks;
        existing.metrics.leads += row.metaLeads;
        existing.metrics.reach += row.reach;
      } else {
        insights.set(insightKey, {
          clientId: client.id,
          adExternalId: row.adExternalId,
          date: row.date,
          metrics: {
            spendCents: row.spendCents,
            impressions: row.impressions,
            clicks: row.clicks,
            leads: row.metaLeads,
            reach: row.reach,
            frequency: row.frequency,
          },
        });
      }

      const snapshotKey = `${client.id}:${row.date}`;
      const day = snapshots.get(snapshotKey);
      if (day) {
        day.metrics.spendCents += row.spendCents;
        day.metrics.impressions += row.impressions;
        day.metrics.clicks += row.clicks;
        day.metrics.leads += row.metaLeads;
        // Reach summed across ads overstates it: one person can see two ads.
        // Kept as an upper bound; impressions is the honest volume metric.
        day.metrics.reach += row.reach;
      } else {
        snapshots.set(snapshotKey, {
          clientId: client.id,
          date: row.date,
          metrics: {
            spendCents: row.spendCents,
            impressions: row.impressions,
            clicks: row.clicks,
            leads: row.metaLeads,
            reach: row.reach,
            frequency: null,
          },
        });
      }
    }
  }

  const now = new Date().toISOString();

  if (campaigns.size > 0) {
    const written = await db.from('campaigns').upsert(
      [...campaigns.values()].map((campaign) => ({
        client_id: campaign.clientId,
        platform: PLATFORM,
        external_id: campaign.externalId,
        name: campaign.name,
        synced_at: now,
      })),
      { onConflict: 'platform,external_id' },
    );
    if (written.error) throw written.error;
    ctx.counts.updated += campaigns.size;
  }

  // Resolve campaign external ids to ours before writing ads.
  const campaignRows = await db
    .from('campaigns')
    .select('id, external_id')
    .eq('platform', PLATFORM);
  if (campaignRows.error) throw campaignRows.error;
  const campaignIdByExternal = new Map(
    (campaignRows.data ?? []).map((row) => [row.external_id, row.id]),
  );

  if (ads.size > 0) {
    const written = await db.from('ads').upsert(
      [...ads.values()].map((ad) => ({
        client_id: ad.clientId,
        campaign_id: ad.campaignExternalId
          ? (campaignIdByExternal.get(ad.campaignExternalId) ?? null)
          : null,
        platform: PLATFORM,
        external_id: ad.externalId,
        adset_external_id: ad.adsetName,
        name: ad.name,
        synced_at: now,
      })),
      { onConflict: 'platform,external_id' },
    );
    if (written.error) throw written.error;
    ctx.counts.updated += ads.size;
  }

  const adRows = await db
    .from('ads')
    .select('id, external_id, campaign_id')
    .eq('platform', PLATFORM);
  if (adRows.error) throw adRows.error;
  const adByExternal = new Map(
    (adRows.data ?? []).map((row) => [
      row.external_id,
      { id: row.id, campaignId: row.campaign_id },
    ]),
  );

  if (insights.size > 0) {
    const rows = [...insights.values()].flatMap((insight) => {
      const ad = adByExternal.get(insight.adExternalId);
      if (!ad) return [];

      return [
        {
          ad_id: ad.id,
          client_id: insight.clientId,
          campaign_id: ad.campaignId,
          insight_on: insight.date,
          spend_cents: insight.metrics.spendCents,
          impressions: insight.metrics.impressions,
          clicks: insight.metrics.clicks,
          leads: insight.metrics.leads,
          reach: insight.metrics.reach,
          frequency: insight.metrics.frequency,
        },
      ];
    });

    if (rows.length !== insights.size) {
      ctx.recordError(
        `${insights.size - rows.length} insight row(s) had no matching ad row`,
      );
    }

    if (rows.length > 0) {
      const written = await db
        .from('ad_level_insights')
        .upsert(rows, { onConflict: 'ad_id,insight_on' });
      if (written.error) throw written.error;
      ctx.counts.created += rows.length;
    }
  }

  if (snapshots.size > 0) {
    const written = await db.from('ad_snapshots').upsert(
      [...snapshots.values()].map((snapshot) => ({
        client_id: snapshot.clientId,
        platform: PLATFORM,
        snapshot_on: snapshot.date,
        spend_cents: snapshot.metrics.spendCents,
        impressions: snapshot.metrics.impressions,
        clicks: snapshot.metrics.clicks,
        leads: snapshot.metrics.leads,
        reach: snapshot.metrics.reach,
      })),
      { onConflict: 'client_id,platform,snapshot_on' },
    );
    if (written.error) throw written.error;
    ctx.counts.updated += snapshots.size;
  }

  // Silence here would read as "no spend". Name the accounts that returned
  // nothing so a broken mapping is visible instead of looking like a quiet week.
  const silent = [...clientByAccount.entries()].filter(
    ([accountId]) => !accountsWithData.has(accountId),
  );
  if (silent.length > 0) {
    ctx.recordError(
      `${silent.length} mapped account(s) returned no rows for this window`,
      { clients: silent.map(([, client]) => client.name) },
    );
  }

  ctx.log(
    `${WINDSOR_CONNECTOR}: ${campaigns.size} campaigns, ${ads.size} ads, ` +
      `${insights.size} ad-days, ${snapshots.size} client-days`,
  );
}
