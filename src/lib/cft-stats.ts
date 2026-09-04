/**
 * The STATS DASHBOARD tab of the Client Fulfilment Tracker, as data.
 *
 * A column-for-column mirror of the sheet, so the per-campaign numbers can be
 * read in the Hub instead of by opening the spreadsheet. Everything here comes
 * from two views that already exist — v_cft_stats_dashboard (client x campaign
 * x day) and v_cft_call_daily (client x day). Read their COMMENT ON VIEW before
 * changing anything: each maps every sheet column letter to its expression and
 * records what it cannot supply.
 *
 * ======================= AGGREGATE FIRST, THEN DIVIDE =======================
 * Every numeric column in both views is additive, and no view stores a
 * percentage. That is deliberate. Averaging a ratio across days gives the wrong
 * answer whenever the days differ in volume — a day with 1 lead and a day with
 * 99 do not contribute equally to CPL, but a mean of two CPLs treats them as if
 * they did. So sum the counters over the whole window, and only then divide.
 * Every derived figure in this file is computed from summed counters.
 * ============================================================================
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Which grain the table is showing. */
export type Breakdown = 'campaign' | 'client';

/** The window presets the sheet itself offers. */
export const WINDOWS = [3, 7, 30] as const;
export type WindowDays = (typeof WINDOWS)[number];

export function isWindow(value: unknown): value is WindowDays {
  return WINDOWS.includes(Number(value) as WindowDays);
}

/**
 * Counters as summed over the window, before anything is divided.
 *
 * Call counters are optional because they have no campaign grain: the calls
 * table carries no campaign reference and calls.deal_id is null on every row.
 * In a campaign breakdown they are absent rather than zero, which is the
 * difference between "no calls" and "cannot be known" — and the reason the six
 * call columns render blank there rather than repeating the client total on
 * every campaign row, which would be double counting.
 */
export interface DashboardRow {
  key: string;
  clientId: string | null;
  status: string | null;
  clientName: string | null;
  campaignName: string | null;
  campaignId: string | null;
  offerName: string | null;

  spendCents: number;
  leads: number;

  apptsCreated: number;
  apptsToBeTaken: number;
  lastApptDate: string | null;
  shows: number;
  noShows: number;
  cancels: number;
  dqs: number;
  closes: number;

  /** Present only at client grain. */
  calls?: CallCounters;
}

export interface CallCounters {
  dialed: number;
  calls2min: number;
  connectedOutbound: number;
  speedToLeadSum: number;
  speedToLeadN: number;
  speedToLeadOver24h: number;
}

/**
 * Everything the sheet shows that is not a stored counter.
 *
 * Null rather than zero whenever the denominator is zero. A CPL of £0 on a
 * campaign with no leads is a claim; a blank is the truth.
 */
export interface Derived {
  cpl: number | null;
  schedulePct: number | null;
  dqPct: number | null;
  cancelPct: number | null;
  showPct: number | null;
  closePct: number | null;
  costPerBooking: number | null;
  costPerShow: number | null;
  costPerClose: number | null;
  speedToLead: number | null;
  pickupPct: number | null;
  conversationPct: number | null;
  dialsPerLead: number | null;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

export function derive(row: DashboardRow): Derived {
  const pounds = row.spendCents / 100;
  const calls = row.calls;

  return {
    cpl: ratio(pounds, row.leads),
    schedulePct: ratio(row.apptsCreated, row.leads),
    dqPct: ratio(row.dqs, row.apptsCreated),
    cancelPct: ratio(row.cancels, row.apptsCreated),
    showPct: ratio(row.shows, row.apptsCreated),
    closePct: ratio(row.closes, row.shows),
    costPerBooking: ratio(pounds, row.apptsCreated),
    costPerShow: ratio(pounds, row.shows),
    costPerClose: ratio(pounds, row.closes),
    speedToLead: calls ? ratio(calls.speedToLeadSum, calls.speedToLeadN) : null,
    pickupPct: calls ? ratio(calls.connectedOutbound, calls.dialed) : null,
    conversationPct: calls ? ratio(calls.calls2min, calls.dialed) : null,
    dialsPerLead: calls ? ratio(calls.dialed, row.leads) : null,
  };
}

/** The inclusive day window, as the two views store their `day` column. */
export function windowFor(days: WindowDays, today = new Date()): {
  from: string;
  to: string;
} {
  const to = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * Read every row in the window, a page at a time.
 *
 * PostgREST returns at most a thousand rows unless asked otherwise, and it does
 * so silently — a truncated read looks exactly like a quiet month. Thirty days
 * is 772 rows today, comfortably under, which is precisely why this is worth
 * writing now rather than after somebody adds clients and the totals start
 * disagreeing with the sheet for no visible reason.
 */
const PAGE = 1000;

async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

export interface StatsViewRow {
  client_id: string | null;
  client_name: string | null;
  status: string | null;
  campaign_name: string | null;
  campaign_id_external: string | null;
  offer_name: string | null;
  spend_cents: number | null;
  leads_best: number | null;
  appts_created: number | null;
  appts_to_be_taken: number | null;
  last_appt_date: string | null;
  shows: number | null;
  no_shows: number | null;
  cancels: number | null;
  dqs: number | null;
  closes: number | null;
}

export interface CallViewRow {
  client_id: string | null;
  client_name: string | null;
  dialed_calls: number | null;
  calls_2min: number | null;
  connected_outbound: number | null;
  speed_to_lead_min_sum: number | null;
  speed_to_lead_n: number | null;
  speed_to_lead_over_24h: number | null;
}

const n = (value: number | null): number => value ?? 0;

function emptyCalls(): CallCounters {
  return {
    dialed: 0,
    calls2min: 0,
    connectedOutbound: 0,
    speedToLeadSum: 0,
    speedToLeadN: 0,
    speedToLeadOver24h: 0,
  };
}

export interface DashboardResult {
  rows: DashboardRow[];
  totals: DashboardRow;
  /** Every client in either feed, for the client filter. */
  clients: { id: string; name: string }[];
  from: string;
  to: string;
}

/**
 * Build the table for one window, breakdown and client filter.
 *
 * The two feeds are combined by client, NOT joined from the stats side. Over a
 * thirty-day window 34 clients have ad or appointment activity and 40 have call
 * activity; the union is 42, so eight clients are call-only. A left join from
 * the stats view would drop those eight and the client count would silently
 * disagree with the sheet.
 */
export async function loadStatsDashboard(
  db: SupabaseClient,
  options: { days: WindowDays; breakdown: Breakdown; clientId?: string | undefined },
): Promise<DashboardResult> {
  const { from, to } = windowFor(options.days);

  const [stats, calls] = await Promise.all([
    readAll<StatsViewRow>((lo, hi) =>
      db
        .from('v_cft_stats_dashboard')
        .select(
          'client_id, client_name, status, campaign_name, campaign_id_external, offer_name, spend_cents, leads_best, appts_created, appts_to_be_taken, last_appt_date, shows, no_shows, cancels, dqs, closes',
        )
        .gte('day', from)
        .lte('day', to)
        .range(lo, hi),
    ),
    readAll<CallViewRow>((lo, hi) =>
      db
        .from('v_cft_call_daily')
        .select(
          'client_id, client_name, dialed_calls, calls_2min, connected_outbound, speed_to_lead_min_sum, speed_to_lead_n, speed_to_lead_over_24h',
        )
        .gte('day', from)
        .lte('day', to)
        .range(lo, hi),
    ),
  ]);

  return { ...aggregate(stats, calls, options), from, to };
}

/**
 * The aggregation, with no database in it.
 *
 * Separated so it can be exercised directly: this is where a grouping or
 * summing mistake would live, and a mistake here is a wrong number on a page
 * about money. npm run check:cft covers the parts that are easy to get wrong —
 * the union of the two feeds, call columns being absent rather than zero at
 * campaign grain, ratios computed from summed counters, and totals recomputed
 * rather than added up from the rows.
 */
export function aggregate(
  stats: StatsViewRow[],
  calls: CallViewRow[],
  options: { breakdown: Breakdown; clientId?: string | undefined },
): Omit<DashboardResult, 'from' | 'to'> {
  // Every client in either feed, so the filter and the client breakdown both
  // include the call-only ones.
  const clientNames = new Map<string, string>();
  for (const row of stats) {
    if (row.client_id) clientNames.set(row.client_id, row.client_name ?? '—');
  }
  for (const row of calls) {
    if (row.client_id) clientNames.set(row.client_id, row.client_name ?? '—');
  }

  const wanted = options.clientId;
  const keep = (clientId: string | null): boolean =>
    wanted === undefined || wanted === '' || clientId === wanted;

  const callsByClient = new Map<string, CallCounters>();
  for (const row of calls) {
    if (!row.client_id || !keep(row.client_id)) continue;
    const held = callsByClient.get(row.client_id) ?? emptyCalls();
    held.dialed += n(row.dialed_calls);
    held.calls2min += n(row.calls_2min);
    held.connectedOutbound += n(row.connected_outbound);
    held.speedToLeadSum += n(row.speed_to_lead_min_sum);
    held.speedToLeadN += n(row.speed_to_lead_n);
    held.speedToLeadOver24h += n(row.speed_to_lead_over_24h);
    callsByClient.set(row.client_id, held);
  }

  const byKey = new Map<string, DashboardRow>();

  for (const row of stats) {
    if (!keep(row.client_id)) continue;

    /*
     * A campaign with no id is a real campaign row, not a fault: 118 of 1,281
     * tracker appointments carry no campaign_external_id. It gets its own row
     * with a blank name rather than being filtered out or folded into another
     * campaign's numbers.
     */
    const key =
      options.breakdown === 'client'
        ? (row.client_id ?? `name:${row.client_name ?? ''}`)
        : [
            row.client_name ?? '',
            row.campaign_name ?? '',
            row.campaign_id_external ?? '',
            row.status ?? '',
            row.offer_name ?? '',
          ].join(' ');

    const held =
      byKey.get(key) ??
      {
        key,
        clientId: row.client_id,
        status: options.breakdown === 'client' ? null : row.status,
        clientName: row.client_name,
        campaignName: options.breakdown === 'client' ? null : row.campaign_name,
        campaignId: options.breakdown === 'client' ? null : row.campaign_id_external,
        offerName: options.breakdown === 'client' ? null : row.offer_name,
        spendCents: 0,
        leads: 0,
        apptsCreated: 0,
        apptsToBeTaken: 0,
        lastApptDate: null,
        shows: 0,
        noShows: 0,
        cancels: 0,
        dqs: 0,
        closes: 0,
      };

    held.spendCents += n(row.spend_cents);
    held.leads += n(row.leads_best);
    held.apptsCreated += n(row.appts_created);
    held.apptsToBeTaken += n(row.appts_to_be_taken);
    held.shows += n(row.shows);
    held.noShows += n(row.no_shows);
    held.cancels += n(row.cancels);
    held.dqs += n(row.dqs);
    held.closes += n(row.closes);

    // Last Appt Date is a max, not a sum — the only non-additive column.
    if (row.last_appt_date && (held.lastApptDate === null || row.last_appt_date > held.lastApptDate)) {
      held.lastApptDate = row.last_appt_date;
    }

    byKey.set(key, held);
  }

  if (options.breakdown === 'client') {
    // Attach call counters, and add the clients that appear only in the call
    // feed — the eight that a join from the stats side would have dropped.
    for (const [clientId, counters] of callsByClient) {
      const held = byKey.get(clientId);
      if (held) {
        held.calls = counters;
        continue;
      }
      byKey.set(clientId, {
        key: clientId,
        clientId,
        status: null,
        clientName: clientNames.get(clientId) ?? '—',
        campaignName: null,
        campaignId: null,
        offerName: null,
        spendCents: 0,
        leads: 0,
        apptsCreated: 0,
        apptsToBeTaken: 0,
        lastApptDate: null,
        shows: 0,
        noShows: 0,
        cancels: 0,
        dqs: 0,
        closes: 0,
        calls: counters,
      });
    }
  }

  const rows = [...byKey.values()].sort((a, b) => b.spendCents - a.spendCents);

  const totals: DashboardRow = {
    key: '__totals__',
    clientId: null,
    status: null,
    clientName: null,
    campaignName: null,
    campaignId: null,
    offerName: null,
    spendCents: 0,
    leads: 0,
    apptsCreated: 0,
    apptsToBeTaken: 0,
    lastApptDate: null,
    shows: 0,
    noShows: 0,
    cancels: 0,
    dqs: 0,
    closes: 0,
    ...(options.breakdown === 'client' ? { calls: emptyCalls() } : {}),
  };

  for (const row of rows) {
    totals.spendCents += row.spendCents;
    totals.leads += row.leads;
    totals.apptsCreated += row.apptsCreated;
    totals.apptsToBeTaken += row.apptsToBeTaken;
    totals.shows += row.shows;
    totals.noShows += row.noShows;
    totals.cancels += row.cancels;
    totals.dqs += row.dqs;
    totals.closes += row.closes;
    if (row.lastApptDate && (totals.lastApptDate === null || row.lastApptDate > totals.lastApptDate)) {
      totals.lastApptDate = row.lastApptDate;
    }
    if (totals.calls && row.calls) {
      totals.calls.dialed += row.calls.dialed;
      totals.calls.calls2min += row.calls.calls2min;
      totals.calls.connectedOutbound += row.calls.connectedOutbound;
      totals.calls.speedToLeadSum += row.calls.speedToLeadSum;
      totals.calls.speedToLeadN += row.calls.speedToLeadN;
      totals.calls.speedToLeadOver24h += row.calls.speedToLeadOver24h;
    }
  }

  return {
    rows,
    totals,
    clients: [...clientNames.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Sort the rows by one of the sheet's columns.
 *
 * Blanks always sink, in both directions. A campaign with no leads has no CPL,
 * and letting null sort as zero would park every unmeasurable row at the top of
 * "cheapest cost per lead" — the most expensive possible misreading of a column
 * somebody is scanning to decide where to put money.
 *
 * The comparison is by value rather than by rendered text, so 9 sorts below 10
 * and "40.0%" sorts as 0.4.
 */
export function sortRows<T>(
  rows: T[],
  valueOf: (row: T) => number | string | null,
  direction: 'asc' | 'desc',
): T[] {
  const sign = direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);

    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;

    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * sign;
    }
    return String(left).localeCompare(String(right)) * sign;
  });
}
