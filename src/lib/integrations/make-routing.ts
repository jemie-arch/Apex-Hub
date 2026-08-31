/**
 * The one thing this codebase is allowed to write into Make: the routing store.
 *
 * Separate from make.ts on purpose. That module reads scenarios and says plainly
 * that it contains no write call, because a bug on a scenario write path would
 * be editing live client automations. This module exists so that promise stays
 * true while still letting the Hub own the routing data.
 *
 * What it writes is deliberately tiny: a key/value store mapping a GoHighLevel
 * location id to the spreadsheet that clinic's bookings belong in. No scenario,
 * no blueprint, no connection, no schedule. The blast radius of a bug here is a
 * lookup returning the wrong sheet — which is bad, and is why nothing reaches
 * this module until a human has verified the row in pps_clinic_routing.
 */
import { makeCredentials, makeRoutingStoreId } from '@/lib/env';

export interface RoutingRecord {
  /** The GoHighLevel location id, which is the store's key. */
  locationId: string;
  spreadsheetId: string;
  practice: string;
}

interface RawRecord {
  key?: unknown;
  data?: { spreadsheet_id?: unknown; practice?: unknown } | null;
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

async function call<T>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const { token, apiBase } = makeCredentials();

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      authorization: `Token ${token}`,
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Make ${method} ${path} responded ${response.status}: ${detail.slice(0, 1200)}`,
    );
  }

  // DELETE returns an empty body on success, which JSON.parse would choke on.
  const raw = await response.text();
  return (raw === '' ? {} : JSON.parse(raw)) as T;
}

/** Everything currently in the store, so the sync can diff rather than clobber. */
export async function currentRecords(): Promise<Map<string, RoutingRecord>> {
  const storeId = makeRoutingStoreId();
  const out = new Map<string, RoutingRecord>();
  let offset = 0;

  /*
   * Paginated, and bounded. The store holds one row per clinic — under a hundred
   * — so the ceiling is a guard against a pagination bug spinning forever
   * against a metered API, not a real limit.
   */
  for (let page = 0; page < 20; page += 1) {
    const body = await call<{ records?: RawRecord[] }>(
      `/data-stores/${encodeURIComponent(storeId)}/data?pg%5Blimit%5D=100&pg%5Boffset%5D=${offset}`,
      'GET',
    );

    const records = body.records ?? [];
    for (const record of records) {
      const key = text(record.key);
      const sheet = text(record.data?.spreadsheet_id);
      if (!key || !sheet) continue;
      out.set(key, {
        locationId: key,
        spreadsheetId: sheet,
        practice: text(record.data?.practice) ?? '',
      });
    }

    if (records.length < 100) break;
    offset += records.length;
  }

  return out;
}

/**
 * Create or overwrite one clinic's routing row.
 *
 * `overwrite` is set because this is a reconcile, not an append: the Hub is the
 * source of truth, so a key that already exists should end up holding what the
 * Hub says rather than erroring.
 */
export async function putRecord(record: RoutingRecord): Promise<void> {
  const storeId = makeRoutingStoreId();
  await call(
    `/data-stores/${encodeURIComponent(storeId)}/data`,
    'POST',
    {
      key: record.locationId,
      data: {
        spreadsheet_id: record.spreadsheetId,
        practice: record.practice,
      },
      overwrite: true,
    },
  );
}

/**
 * Remove routing rows for clinics the Hub no longer publishes.
 *
 * Called only with keys the Hub has deliberately withdrawn — a clinic that went
 * inactive, or whose sheet became contested. Leaving a stale row behind would
 * keep routing bookings for a practice nobody is checking any more.
 */
export async function deleteRecords(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const storeId = makeRoutingStoreId();
  await call(
    `/data-stores/${encodeURIComponent(storeId)}/data`,
    'DELETE',
    { keys, confirmed: true },
  );
}
