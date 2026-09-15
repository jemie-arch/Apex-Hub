/**
 * What each campaign cost and what it booked.
 *
 * The first thing in this system that reaches from money spent to a patient in
 * a chair. Spend comes from Windsor, bookings and treatment value come from the
 * practice stat sheets, and the two meet on the campaign id both of them carry.
 * No Meta access is involved, which matters because nobody here has any.
 *
 * ATTRIBUTION STARTS IN AUGUST 2026. Campaign ids appear on 0% of bookings
 * before July, 42.5% in August and 84% in September. Nothing is broken and
 * nothing needs chasing — it was switched on and is filling up. But it does
 * mean a window reaching back further than August dilutes every rate with
 * months that could never have been attributed, so the default window is short
 * and the page says why.
 *
 * CAMPAIGN GRAIN IS THE FINEST THIS SUPPORTS. The sheets' Ad ID column is
 * populated 34 times in 1,397 rows. Campaign is populated 172 times and
 * resolves to the right practice every time it was checked. Anything finer
 * would be invention.
 */
import { serviceClient } from '@/lib/supabase/service';

export interface CampaignRow {
  campaignId: string;
  campaignName: string | null;
  clientName: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  bookings: number;
  shows: number;
  converted: number;
  treatmentValueCents: number;
  /** How many of the bookings carry a value. The rest are not zero-value. */
  bookingsWithAValue: number;

  /** Blank rather than zero when the denominator is missing. */
  costPerBookingCents: number | null;
  costPerShowCents: number | null;
  costPerConversionCents: number | null;
  showRate: number | null;
  conversionRate: number | null;
  /** Treatment value over spend. Null unless BOTH sides are known. */
  returnOnSpend: number | null;
}

export interface CampaignEconomics {
  rows: CampaignRow[];
  totals: {
    spendCents: number;
    bookings: number;
    shows: number;
    converted: number;
    treatmentValueCents: number;
    bookingsWithAValue: number;
  };
}

const rate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

/**
 * A cost per something, blank unless the cost is actually known.
 *
 * Spend of zero against four bookings does not mean they were free — it means
 * no spend is recorded against that campaign for the window, and "£0.00 per
 * booking" is the most flattering possible lie. Same rule the fulfilment
 * tracker follows.
 */
const cost = (spend: number, denominator: number): number | null =>
  spend === 0 ? null : rate(spend, denominator);

export async function getCampaignEconomics(range: {
  from: string;
  to: string;
}): Promise<CampaignEconomics> {
  const db = serviceClient();

  const { data, error } = await db
    .from('v_campaign_economics')
    .select(
      'campaign_external_id, campaign_name, client_name, spend_cents, impressions, clicks, bookings, shows, converted, treatment_value_cents, bookings_with_a_value',
    )
    .gte('day', range.from)
    .lte('day', range.to);

  if (error) throw error;

  interface Bucket extends Omit<CampaignRow,
    | 'costPerBookingCents' | 'costPerShowCents' | 'costPerConversionCents'
    | 'showRate' | 'conversionRate' | 'returnOnSpend'> {}

  const buckets = new Map<string, Bucket>();

  for (const row of data ?? []) {
    const id = row.campaign_external_id;
    if (!id) continue;

    const held = buckets.get(id) ?? {
      campaignId: id,
      campaignName: row.campaign_name,
      clientName: row.client_name ?? '—',
      spendCents: 0,
      impressions: 0,
      clicks: 0,
      bookings: 0,
      shows: 0,
      converted: 0,
      treatmentValueCents: 0,
      bookingsWithAValue: 0,
    };

    held.spendCents += Number(row.spend_cents ?? 0);
    held.impressions += Number(row.impressions ?? 0);
    held.clicks += Number(row.clicks ?? 0);
    held.bookings += Number(row.bookings ?? 0);
    held.shows += Number(row.shows ?? 0);
    held.converted += Number(row.converted ?? 0);
    held.treatmentValueCents += Number(row.treatment_value_cents ?? 0);
    held.bookingsWithAValue += Number(row.bookings_with_a_value ?? 0);

    buckets.set(id, held);
  }

  /*
   * Summed first, divided after. A day with one booking and a day with forty do
   * not contribute equally to a cost per booking, and averaging the two daily
   * costs pretends they do.
   */
  const rows: CampaignRow[] = [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      costPerBookingCents: cost(bucket.spendCents, bucket.bookings),
      costPerShowCents: cost(bucket.spendCents, bucket.shows),
      costPerConversionCents: cost(bucket.spendCents, bucket.converted),
      showRate: rate(bucket.shows, bucket.bookings),
      conversionRate: rate(bucket.converted, bucket.shows),
      /*
       * Null unless the campaign has BOTH spend and a recorded value. A return
       * on spend computed from one booking that happened to carry a value, out
       * of twenty that did not, is not a return on anything.
       */
      returnOnSpend:
        bucket.spendCents === 0 || bucket.bookingsWithAValue === 0
          ? null
          : bucket.treatmentValueCents / bucket.spendCents,
    }))
    .sort((a, b) => b.spendCents - a.spendCents);

  const totals = rows.reduce(
    (sum, row) => ({
      spendCents: sum.spendCents + row.spendCents,
      bookings: sum.bookings + row.bookings,
      shows: sum.shows + row.shows,
      converted: sum.converted + row.converted,
      treatmentValueCents: sum.treatmentValueCents + row.treatmentValueCents,
      bookingsWithAValue: sum.bookingsWithAValue + row.bookingsWithAValue,
    }),
    {
      spendCents: 0,
      bookings: 0,
      shows: 0,
      converted: 0,
      treatmentValueCents: 0,
      bookingsWithAValue: 0,
    },
  );

  return { rows, totals };
}
