/**
 * Windsor.ai connector client — the app's source of ad data.
 *
 * Chosen over the Meta Graph API because every ad account is already
 * authorised in Windsor. Going direct would mean getting ads_read granted on
 * 45 client-owned accounts and then owning token expiry for each.
 *
 * Field ids below were confirmed against the live account: `date`, `account_id`,
 * `account_name`, `campaign_id`, `campaign`, `ad_id`, `ad_name`, `spend`,
 * `impressions`, `clicks`, `reach`, `frequency`, `actions_lead`. Note that
 * `leads` is NOT a field — it is `actions_lead`.
 *
 * Verified from real rows: spend arrives as a NUMBER (0.19, 37.87), not the
 * decimal string the Graph API sends. It still goes through toCents() so both
 * shapes are safe.
 *
 * NOTE: the field ids and value shapes are confirmed, but the REST envelope is
 * not — this code reads Windsor's HTTP API, whereas the shapes were verified
 * through its MCP interface. Both `{ data: [...] }` and a bare array are
 * therefore accepted.
 */
import { windsorCredentials } from '@/lib/env';

/** The one connector in use. Adding Google Ads later is a slug change. */
export const WINDSOR_CONNECTOR = 'facebook';

const FIELDS = [
  'date',
  'account_id',
  'account_name',
  'campaign_id',
  'campaign',
  'ad_id',
  'ad_name',
  'adset_name',
  'spend',
  'impressions',
  'clicks',
  'reach',
  'frequency',
  'actions_lead',
] as const;

export interface WindsorAdRow {
  date: string;
  accountId: string;
  accountName: string | null;
  campaignExternalId: string | null;
  campaignName: string | null;
  adExternalId: string;
  adName: string | null;
  adsetName: string | null;
  spendCents: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number | null;
  /**
   * Meta's own lead count. Observed as 0 across accounts that are plainly
   * generating leads, because the forms live downstream in the CRM — so treat
   * this as a lower bound and take real lead volume from the CRM instead.
   */
  metaLeads: number;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (typeof value === 'number') return String(value);
  return null;
}

/** Currency to integer cents, accepting both number and decimal string. */
function toCents(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) : 0;
  }
  if (typeof value !== 'string' || value.trim() === '') return 0;

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function toInt(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value !== 'string' || value.trim() === '') return 0;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFloat(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** YYYY-MM-DD, whatever Windsor sends (date or timestamp). */
function toDateOnly(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match?.[1] ?? null;
}

/**
 * One ad-per-day row set for the given accounts and window.
 *
 * Accounts are passed in batches by the caller: one request for all 45 would
 * make a single timeout lose everything, and per-account requests would mean 45
 * round trips.
 */
export async function fetchAdRows(
  accountIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<WindsorAdRow[]> {
  const { apiKey, apiBase } = windsorCredentials();

  const url = new URL(`${apiBase}/${WINDSOR_CONNECTOR}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('fields', FIELDS.join(','));
  url.searchParams.set('date_from', dateFrom);
  url.searchParams.set('date_to', dateTo);
  if (accountIds.length > 0) {
    url.searchParams.set('accounts', accountIds.join(','));
  }

  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    const detail = await response.text();
    // The key rides in the query string, so the URL never appears in an error.
    throw new Error(
      `Windsor ${WINDSOR_CONNECTOR} responded ${response.status}: ` +
        detail.slice(0, 300),
    );
  }

  const payload: unknown = await response.json();

  const rows = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' &&
        payload !== null &&
        Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : [];

  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const record = row as Record<string, unknown>;

    const date = toDateOnly(record['date']);
    const accountId = asString(record['account_id']);
    const adExternalId = asString(record['ad_id']);

    // Without these three a row cannot be filed anywhere, so it is dropped
    // rather than written under a guessed key.
    if (!date || !accountId || !adExternalId) return [];

    return [
      {
        date,
        accountId,
        accountName: asString(record['account_name']),
        campaignExternalId: asString(record['campaign_id']),
        campaignName: asString(record['campaign']),
        adExternalId,
        adName: asString(record['ad_name']),
        adsetName: asString(record['adset_name']),
        spendCents: toCents(record['spend']),
        impressions: toInt(record['impressions']),
        clicks: toInt(record['clicks']),
        reach: toInt(record['reach']),
        frequency: toFloat(record['frequency']),
        metaLeads: toInt(record['actions_lead']),
      },
    ];
  });
}
