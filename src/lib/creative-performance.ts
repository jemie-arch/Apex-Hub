/**
 * Which creatives are working, which are burning out, and what to run next.
 *
 * This is the in-house answer to the ad-spy tools media buying was looking at.
 * Those products rank other people's ads from the public ad library; this ranks
 * our own 565, which is the more useful direction — a competitor's creative
 * tells you what they are trying, ours tells you what actually spends well in
 * dental.
 *
 * WHAT A WINNER IS ALLOWED TO BE MEASURED ON
 *
 * Not leads. Meta reports 228 of them against $104,920 of spend, and 32 of our
 * 36 ad accounts report exactly zero. That is not a performance signal, it is a
 * record of which accounts have the pixel wired up, and ranking on it would
 * rank the plumbing.
 *
 * Not bookings, which is the number anyone would actually want. All 1,443 rows
 * in appointments carry a null ad_external_id and so does every row in
 * tracker_appointments — nothing in the pipeline writes it. The only ad
 * attribution anywhere is on tracker_leads, and 480 of its 1,101 resolvable
 * rows name an ad belonging to a different practice. A 56%-clean signal is
 * worse than no signal, because it looks like data.
 *
 * So: spend, impressions and clicks, which come from Meta's own billing and
 * serving records rather than from tracking we installed. CTR and CPC built on
 * those are honest, and they are what a media buyer reads first anyway.
 *
 * THE COST OF THAT CHOICE, stated plainly: a creative that wins attention and
 * books nobody will rank well here. CTR is the top of the funnel, not the
 * bottom. This board finds creatives worth testing further; it cannot tell you
 * which one filled a chair. Closing that gap needs ad_external_id populated on
 * appointments, and until then no amount of maths on this end will produce it.
 */
import { serviceClient } from '@/lib/supabase/service';

/**
 * Below this, click-through rate is noise rather than a measurement. At 1,000
 * impressions a single stray click moves CTR by a tenth of a point, which is
 * the whole distance between an average creative and a good one.
 */
const MIN_IMPRESSIONS = 5_000;

/** A creative this far above the fleet median is worth more budget. */
const SCALE_AT = 1.2;

/** This far below and it is spending money to be ignored. */
const CUT_AT = 0.7;

/**
 * A CTR fall of a quarter between the two halves of the window. Creative
 * fatigue on Meta shows up as exactly this: same audience, same creative,
 * steadily fewer people bothering to click.
 */
const FATIGUE_AT = -0.25;

export type Verdict = 'scale' | 'refresh' | 'cut' | 'hold';

export interface CreativeRow {
  name: string;
  /** How many practices ran this creative in the window. */
  practices: number;
  /** Distinct ad ids — the same creative relaunched keeps its name, not its id. */
  variants: number;
  spendCents: number;
  impressions: number;
  clicks: number;
  /** Clicks over impressions. Null when it did not clear MIN_IMPRESSIONS. */
  ctr: number | null;
  /** Cost per click, in cents. Null when nothing was clicked. */
  cpcCents: number | null;
  /** CTR over the newer half of the window, and the older half. */
  ctrRecent: number | null;
  ctrPrior: number | null;
  /** Relative change between the two halves. -0.3 means CTR fell 30%. */
  trend: number | null;
  verdict: Verdict;
  /** Why this verdict, in a sentence the reader does not have to decode. */
  reason: string;
}

export interface CreativeBoard {
  rows: CreativeRow[];
  /** The median CTR every verdict is judged against. */
  medianCtr: number | null;
  /** Creatives that ran but could not be judged, and the spend they hold. */
  belowFloor: number;
  belowFloorSpendCents: number;
  latestDay: string | null;
}

interface Bucket {
  name: string;
  practices: Set<string>;
  variants: Set<string>;
  spendCents: number;
  impressions: number;
  clicks: number;
  recentImpressions: number;
  recentClicks: number;
  priorImpressions: number;
  priorClicks: number;
}

/**
 * Every rate here divides summed counters. A creative that ran 200 impressions
 * on Monday and 20,000 on Tuesday does not get Monday's CTR weighted equally —
 * averaging the daily rates would do exactly that, and it is the single easiest
 * way to make a bad creative look good.
 */
const rate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export async function getCreativeBoard(range: {
  from: string;
  to: string;
}): Promise<CreativeBoard> {
  const db = serviceClient();

  const { data, error } = await db
    .from('v_ad_creative_daily')
    .select('day, ad_id, ad_name, client_id, spend_cents, impressions, clicks')
    .gte('day', range.from)
    .lte('day', range.to);

  if (error) throw error;

  const days = (data ?? [])
    .map((row) => row.day)
    .filter((day): day is string => Boolean(day));

  const latestDay = days.length > 0 ? days.reduce((a, b) => (a > b ? a : b)) : null;

  /*
   * The midpoint splits the window into an older and a newer half for the
   * trend. Taken from the range the user asked for rather than from the data,
   * so a creative that stopped running halfway through reads as a collapse in
   * CTR — which is what it is from a media buyer's point of view — instead of
   * quietly comparing its last two live days against each other.
   */
  const from = Date.parse(`${range.from}T00:00:00.000Z`);
  const to = Date.parse(`${range.to}T00:00:00.000Z`);
  const midpoint = new Date((from + to) / 2).toISOString().slice(0, 10);

  const buckets = new Map<string, Bucket>();

  for (const row of data ?? []) {
    const name = row.ad_name;
    if (!name) continue;

    let bucket = buckets.get(name);
    if (!bucket) {
      bucket = {
        name,
        practices: new Set(),
        variants: new Set(),
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        recentImpressions: 0,
        recentClicks: 0,
        priorImpressions: 0,
        priorClicks: 0,
      };
      buckets.set(name, bucket);
    }

    if (row.client_id) bucket.practices.add(row.client_id);
    if (row.ad_id) bucket.variants.add(row.ad_id);

    const impressions = row.impressions ?? 0;
    const clicks = row.clicks ?? 0;

    bucket.spendCents += row.spend_cents ?? 0;
    bucket.impressions += impressions;
    bucket.clicks += clicks;

    if ((row.day ?? '') >= midpoint) {
      bucket.recentImpressions += impressions;
      bucket.recentClicks += clicks;
    } else {
      bucket.priorImpressions += impressions;
      bucket.priorClicks += clicks;
    }
  }

  const all = [...buckets.values()];
  const qualifying = all.filter((b) => b.impressions >= MIN_IMPRESSIONS);
  const belowFloorBuckets = all.filter((b) => b.impressions < MIN_IMPRESSIONS);

  const medianCtr = median(
    qualifying
      .map((b) => rate(b.clicks, b.impressions))
      .filter((value): value is number => value !== null),
  );

  const rows: CreativeRow[] = qualifying
    .map((bucket) => {
      const ctr = rate(bucket.clicks, bucket.impressions);
      const cpcCents = rate(bucket.spendCents, bucket.clicks);

      /*
       * Each half needs its own floor. Without it a creative with 40
       * impressions in the older half and 19,000 in the newer half produces a
       * trend built on a sample that could not support one, and the board
       * would tell somebody to bin a creative on the strength of two clicks.
       */
      const half = MIN_IMPRESSIONS / 4;
      const ctrRecent =
        bucket.recentImpressions >= half
          ? rate(bucket.recentClicks, bucket.recentImpressions)
          : null;
      const ctrPrior =
        bucket.priorImpressions >= half
          ? rate(bucket.priorClicks, bucket.priorImpressions)
          : null;

      const trend =
        ctrRecent !== null && ctrPrior !== null && ctrPrior > 0
          ? (ctrRecent - ctrPrior) / ctrPrior
          : null;

      let verdict: Verdict = 'hold';
      let reason = 'Performing about where the fleet does.';

      if (medianCtr !== null && ctr !== null) {
        const relative = ctr / medianCtr;

        /*
         * Fatigue is checked BEFORE the winner test, deliberately. A creative
         * can still be well above the fleet median while falling off a cliff,
         * and "scale this" is the worst possible advice to give about it — the
         * extra budget buys the declining half of its life.
         */
        if (trend !== null && trend <= FATIGUE_AT) {
          verdict = 'refresh';
          reason = `Click-through fell ${Math.abs(Math.round(trend * 100))}% across the window. Same creative, fewer people biting — worth a fresh cut before it decays further.`;
        } else if (relative >= SCALE_AT) {
          verdict = 'scale';
          reason = `${Math.round((relative - 1) * 100)}% above the fleet median click-through, and holding. The clearest case for more budget or a wider rollout.`;
        } else if (relative <= CUT_AT) {
          verdict = 'cut';
          reason = `${Math.round((1 - relative) * 100)}% below the fleet median click-through. It is buying impressions nobody acts on.`;
        }
      }

      return {
        name: bucket.name,
        practices: bucket.practices.size,
        variants: bucket.variants.size,
        spendCents: bucket.spendCents,
        impressions: bucket.impressions,
        clicks: bucket.clicks,
        ctr,
        cpcCents,
        ctrRecent,
        ctrPrior,
        trend,
        verdict,
        reason,
      };
    })
    .sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0));

  return {
    rows,
    medianCtr,
    belowFloor: belowFloorBuckets.length,
    belowFloorSpendCents: belowFloorBuckets.reduce((sum, b) => sum + b.spendCents, 0),
    latestDay,
  };
}
