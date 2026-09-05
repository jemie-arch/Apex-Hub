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

/**
 * Days of history rewritten each run, including today. Seven by default.
 *
 * Overridable because the window is also the only way to repair history. When
 * the double-counting fix landed it corrected the seven days it rewrote and
 * left everything older still doubled — the run cannot reach back further than
 * this number, so a one-off backfill means widening it, running once, and
 * putting it back.
 *
 * Prefer rewriting from Windsor over arithmetic. Halving the old rows in SQL
 * would have been quicker and would have assumed the very thing that needs
 * proving; a rewrite takes the number from the source either way.
 *
 * Kept at seven for the nightly run because it is the cheap end of the trade:
 * each extra week is another round trip per account, and maxDuration on the
 * route is 300 seconds. Thirty days is comfortably inside that; a year is not.
 */
const WINDOW_DAYS = (() => {
  const configured = Number(process.env['WINDSOR_WINDOW_DAYS']);
  return Number.isInteger(configured) && configured > 0 && configured <= 400
    ? configured
    : 7;
})();

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
    /*
     * Recorded as a problem, not merely logged.
     *
     * This branch used to return quietly and the run was filed as a success
     * that read nothing — indistinguishable, on the Settings page and in
     * sync_runs, from a genuinely quiet day. An unconfigured integration has
     * to look different from a working one, or it stays unconfigured.
     */
    ctx.recordError(
      'no client has an ad_account_id set, so no ad data can be pulled — map ' +
        'Windsor account ids onto clients first',
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

  /** Ad-days Windsor sent more than once in a single run. See the note below. */
  let duplicateAdDays = 0;

  for (const batch of chunk([...clientByAccount.keys()], BATCH_SIZE)) {
    let rows;
    try {
      rows = await fetchAdRows(batch, dateFrom, dateTo);
    } catch (error) {
      /*
       * A batch fails as a unit, so one bad account takes nine good ones with
       * it. Retry them singly before giving up.
       *
       * On 2 September both batches failed with the same Facebook error, naming
       * one account: "incomplete time-series data ... [Error pulling data for
       * account 1020057142322568]". Twenty practices got no ad data that run
       * because of one of them. Nothing was lost for good — the window is
       * rewritten in full every run, so the next one recovers it — but a whole
       * day of every practice's ad spend was missing from the portal in the
       * meantime, and it did not need to be.
       *
       * The cost is bounded and only paid when something is already wrong: one
       * request per account in a failed batch, never on the happy path.
       */
      const batchDetail = error instanceof Error ? error.message : String(error);
      const salvaged: Awaited<ReturnType<typeof fetchAdRows>> = [];
      const stillFailing: string[] = [];

      for (const account of batch) {
        try {
          salvaged.push(...(await fetchAdRows([account], dateFrom, dateTo)));
        } catch {
          stillFailing.push(account);
        }
      }

      if (stillFailing.length > 0) {
        ctx.recordError(
          `Windsor request failed for ${stillFailing.length} account(s), ` +
            `after salvaging ${batch.length - stillFailing.length} of ${batch.length} ` +
            'from a failed batch by asking one at a time',
          { accounts: stillFailing, detail: batchDetail },
        );
      } else {
        ctx.log(
          `A batch of ${batch.length} failed as a unit and every account in it ` +
            'succeeded on its own, so nothing was lost.',
        );
      }

      if (salvaged.length === 0) continue;
      rows = salvaged;
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

      /*
       * ONE ROW PER AD PER DAY. NOT A SUM.
       *
       * This used to add, and the numbers were exactly double Meta's for every
       * account and every day: City Dental 25 August read $343.66 against
       * Windsor's $171.83, and the same 2.0 ratio held on 26, 27, 28 and 31
       * August and 1 and 2 September. Windsor was returning each ad-day twice
       * and the sync was faithfully totalling both copies.
       *
       * Adding was never right at this grain. The request carries no
       * breakdown — no placement, no platform, no age — so Windsor has exactly
       * one row per ad per day to give, and a second row with the same key is
       * a duplicate rather than another slice to be included. Summing made the
       * sync depend on the API never repeating itself, and it repeated itself.
       *
       * The client-day snapshot below still adds, and must: that key is
       * client + date, so it genuinely sums many ads into one day.
       *
       * Duplicates are counted and reported rather than silently dropped. The
       * count is how we learn whether Windsor stops doing this, or why it
       * started — most likely the same ad account connected twice in the
       * Windsor workspace, which nothing on our side can see.
       */
      const insightKey = `${row.adExternalId}:${row.date}`;
      const existing = insights.get(insightKey);
      if (existing) {
        duplicateAdDays += 1;
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

  if (duplicateAdDays > 0) {
    /*
     * An error, not a note. Until this was found every cost figure in the Hub
     * was double what Meta reported — CPL, cost per booking, cost per show, and
     * the ad spend the client portal used to show a practice. It is corrected
     * here, but the cause is upstream and somebody has to go and look at it.
     */
    ctx.recordError(
      `Windsor returned ${duplicateAdDays} ad-day row(s) more than once. Each ` +
        'duplicate was ignored rather than added, which is why these figures no ' +
        'longer read double. The likeliest cause is the same ad account being ' +
        'connected twice in the Windsor workspace.',
      { duplicateAdDays },
    );
  }

  ctx.log(
    `${WINDSOR_CONNECTOR}: ${campaigns.size} campaigns, ${ads.size} ads, ` +
      `${insights.size} ad-days, ${snapshots.size} client-days` +
      (duplicateAdDays > 0 ? `, ${duplicateAdDays} duplicate row(s) ignored` : ''),
  );
}
