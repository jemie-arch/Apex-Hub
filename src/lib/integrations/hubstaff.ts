/**
 * Hubstaff, read-only.
 *
 * One question: how many hours did each person track in a given window. That is
 * all the payout needs, and it is the only thing this module asks for.
 *
 * The awkward part is authentication, and it is worth explaining because the
 * obvious implementation is broken.
 *
 * What Hubstaff calls a Personal Access Token is a REFRESH token, not a bearer
 * token. It buys an access token that lasts 24 hours, from
 * POST https://account.hubstaff.com/access_tokens with grant_type=refresh_token,
 * form-encoded, no client credentials. Sending the PAT itself as a bearer — which
 * is what this module used to do — just returns 401.
 *
 * Worse, and this is the bit that dictates the design: the refresh token ROTATES
 * on every exchange, and the string that was used stops being accepted. So
 * holding it in an immutable environment variable cannot work. It would succeed
 * once, rotate, and then fail forever against a value nothing can update — which
 * presents as "it worked when we set it up and broke silently later", the worst
 * possible failure shape for a payroll input.
 *
 * So HUBSTAFF_TOKEN is a seed, used only when the database has no token yet.
 * After that the live pair lives in oauth_tokens, and every exchange writes the
 * rotated refresh token back before the token is used for anything else.
 *
 * Dates rather than timestamps on the daily endpoint. Hubstaff's daily activity
 * report is keyed on the worker's own date, which is what a fortnight boundary
 * means to a person being paid; asking for a UTC instant would split somebody's
 * Friday evening across two periods depending on where they live.
 */
import { hubstaffCredentials, NotConfiguredError } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

/** Matches the agency-level row shape: no client, no location. */
const PROVIDER = 'hubstaff';

const TOKEN_URL = 'https://account.hubstaff.com/access_tokens';

/**
 * Treat an access token as expired this long before it really is, so a token
 * cannot lapse between the check and the request that uses it.
 */
const EXPIRY_MARGIN_MS = 120_000;

export interface HubstaffMember {
  id: string;
  name: string | null;
  email: string | null;
}

interface RawOrganization {
  id?: unknown;
  name?: unknown;
}

interface RawUser {
  id?: unknown;
  name?: unknown;
  email?: unknown;
}

interface RawActivity {
  user_id?: unknown;
  tracked?: unknown;
}

interface StoredToken {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function seconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

async function readStored(): Promise<StoredToken | null> {
  const db = serviceClient();
  const row = await db
    .from('oauth_tokens')
    .select('id, access_token, refresh_token, expires_at')
    .eq('provider', PROVIDER)
    .is('client_id', null)
    .is('crm_location_id', null)
    .maybeSingle();

  if (row.error) throw row.error;
  if (!row.data) return null;

  return {
    id: row.data.id,
    accessToken: row.data.access_token,
    refreshToken: row.data.refresh_token,
    expiresAt: row.data.expires_at,
  };
}

function fresh(token: StoredToken): boolean {
  if (!token.expiresAt) return false;
  return Date.parse(token.expiresAt) - EXPIRY_MARGIN_MS > Date.now();
}

/**
 * Exchange a refresh token, and persist the result before returning it.
 *
 * The write happens first and unconditionally. If it were deferred until after
 * the API call that needed the token, a failure in that call would lose the
 * rotated refresh token while Hubstaff had already invalidated the old one —
 * permanently orphaning the integration on the strength of one bad request.
 */
async function exchange(refreshToken: string): Promise<string> {
  const db = serviceClient();

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
    cache: 'no-store',
  });

  const raw = await response.text();

  if (!response.ok) {
    /*
     * Recorded against the row so the failure survives the process. A rejected
     * exchange usually means the refresh token has expired (90 days, sliding) or
     * was already rotated by another exchange — and both need a human to mint a
     * new PAT, which they will not know to do from a log line nobody reads.
     */
    await db
      .from('oauth_tokens')
      .update({
        last_error: `exchange failed ${response.status}: ${raw.slice(0, 500)}`,
        updated_at: new Date().toISOString(),
      })
      .eq('provider', PROVIDER)
      .is('client_id', null)
      .is('crm_location_id', null);

    throw new Error(
      `Hubstaff refused the token exchange (${response.status}). The personal ` +
        'access token has probably expired or been rotated elsewhere; mint a ' +
        'new one in Hubstaff under Account then Personal access tokens and set ' +
        `HUBSTAFF_TOKEN to it. Response: ${raw.slice(0, 500)}`,
    );
  }

  let body: {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(
      `Hubstaff returned a token response that is not JSON: ${raw.slice(0, 300)}`,
    );
  }

  const accessToken = text(body.access_token);
  const rotated = text(body.refresh_token);

  if (!accessToken) {
    throw new Error(
      'Hubstaff accepted the exchange but returned no access_token, so there is ' +
        'nothing to authenticate with.',
    );
  }

  /*
   * Fall back to the token we sent if Hubstaff returns none, rather than writing
   * null. Null would wipe the only credential the integration has.
   */
  const nextRefresh = rotated ?? refreshToken;

  const expiresIn = seconds(body.expires_in);
  const expiresAt = new Date(
    Date.now() + (expiresIn > 0 ? expiresIn : 86_400) * 1000,
  ).toISOString();

  const existing = await readStored();
  const record = {
    provider: PROVIDER,
    client_id: null,
    crm_location_id: null,
    access_token: accessToken,
    refresh_token: nextRefresh,
    expires_at: expiresAt,
    scope: text(body.scope),
    refreshed_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  };

  const written = existing
    ? await db.from('oauth_tokens').update(record).eq('id', existing.id)
    : await db.from('oauth_tokens').insert(record);

  if (written.error) {
    /*
     * Fatal on purpose. The exchange has already happened, so Hubstaff has
     * rotated and the token in hand is the only valid one — carrying on would
     * use it once and lose it. Better to fail now, while the previous token is
     * at least still recorded, than to silently orphan the integration.
     */
    throw new Error(
      'Hubstaff issued a new token pair but it could not be saved, so the ' +
        'rotated refresh token would be lost. Nothing was read. Detail: ' +
        written.error.message,
    );
  }

  return accessToken;
}

/**
 * A usable access token: the stored one while it is still valid, otherwise a
 * fresh exchange.
 *
 * Not safe to call concurrently, and it does not need to be. Every caller is a
 * sync, syncs run sequentially in the nightly cycle, and two simultaneous
 * exchanges would each rotate — leaving one holding a dead token. If this ever
 * needs to run in parallel it wants a lock, not a retry.
 */
async function accessToken(force = false): Promise<string> {
  const stored = await readStored();

  if (stored && !force && fresh(stored)) return stored.accessToken;

  const refresh = stored?.refreshToken ?? hubstaffCredentials().token;

  if (!refresh) {
    throw new NotConfiguredError(
      'Hubstaff has no refresh token: the database holds none and ' +
        'HUBSTAFF_TOKEN is not set. Create a personal access token in Hubstaff ' +
        'under Account then Personal access tokens and set HUBSTAFF_TOKEN to ' +
        'it; it is read once and then kept in oauth_tokens, because Hubstaff ' +
        'rotates it on every use.',
    );
  }

  return exchange(refresh);
}

async function get<T>(path: string): Promise<T> {
  const { apiBase } = hubstaffCredentials();

  const send = async (token: string) =>
    fetch(`${apiBase}${path}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      cache: 'no-store',
    });

  let response = await send(await accessToken());

  /*
   * One forced refresh on a 401, then give up. An access token can expire
   * mid-cycle on a long run, and re-exchanging once is the cheap fix. Retrying
   * more than once would rotate the refresh token repeatedly against an
   * endpoint that is rejecting us for some other reason.
   */
  if (response.status === 401) {
    response = await send(await accessToken(true));
  }

  if (!response.ok) {
    const body = await response.text();
    /*
     * The body is included because Hubstaff's 401 and 403 read very differently
     * — an expired token versus a token whose scopes do not cover the
     * organisation — and that distinction is the whole diagnosis.
     */
    throw new Error(
      `Hubstaff ${path} responded ${response.status}: ${body.slice(0, 1200)}`,
    );
  }

  return (await response.json()) as T;
}

/**
 * The organisation this token can see.
 *
 * Discovered rather than demanded. A token belongs to a person, and that person
 * usually has exactly one organisation — so making the id a required setting
 * would fail on a value nobody knew to look up. If there are several and none is
 * configured, this says so and names them rather than guessing.
 */
export async function resolveOrganizationId(): Promise<string> {
  const configured = hubstaffCredentials().organizationId;
  if (configured) return configured;

  const body = await get<{ organizations?: RawOrganization[] }>(
    '/organizations',
  );
  const orgs = (body.organizations ?? []).flatMap((row) => {
    const id = text(row.id);
    return id ? [{ id, name: text(row.name) ?? id }] : [];
  });

  if (orgs.length === 0) {
    throw new Error(
      'The Hubstaff token can see no organisations. Check the personal access ' +
        'token was created by a member of the Apex organisation, and that its ' +
        'scopes cover reading organisations — a token scoped too narrowly ' +
        'succeeds here and returns nothing.',
    );
  }
  if (orgs.length > 1) {
    throw new Error(
      'The Hubstaff token can see several organisations, so which one to read ' +
        'is ambiguous. Set HUBSTAFF_ORGANIZATION_ID to one of: ' +
        orgs.map((o) => `${o.name} (${o.id})`).join(', '),
    );
  }

  return orgs[0]!.id;
}

/** Everybody in the organisation, so tracked time can be attributed to a person. */
export async function listMembers(
  organizationId: string,
): Promise<HubstaffMember[]> {
  const body = await get<{ users?: RawUser[] }>(
    `/organizations/${encodeURIComponent(organizationId)}/members?include=users`,
  );

  return (body.users ?? []).flatMap((row) => {
    const id = text(row.id);
    return id
      ? [{ id, name: text(row.name), email: text(row.email)?.toLowerCase() ?? null }]
      : [];
  });
}

/**
 * Seconds tracked per person between two dates, inclusive.
 *
 * Summed across days here rather than returned per day, because a payout period
 * is the unit that matters and per-day detail would only be discarded upstream.
 *
 * Paginated on the documented cursor. Bounded so a pagination bug cannot spin
 * forever against a metered API.
 */
export async function trackedSecondsByUser(
  organizationId: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  let cursor: string | null = null;

  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({
      'date[start]': from,
      'date[stop]': to,
    });
    if (cursor) query.set('page_start_id', cursor);

    const body = await get<{
      daily_activities?: RawActivity[];
      pagination?: { next_page_start_id?: unknown };
    }>(
      `/organizations/${encodeURIComponent(organizationId)}` +
        `/activities/daily?${query.toString()}`,
    );

    const rows = body.daily_activities ?? [];
    for (const row of rows) {
      const userId = text(row.user_id);
      if (!userId) continue;
      totals.set(userId, (totals.get(userId) ?? 0) + seconds(row.tracked));
    }

    const next = text(body.pagination?.next_page_start_id);
    if (!next || rows.length === 0) break;
    cursor = next;
  }

  return totals;
}
