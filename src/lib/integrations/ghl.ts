/**
 * GoHighLevel API v2 client.
 *
 * Tokens live in oauth_tokens, one row per client plus one agency-level row,
 * and are refreshed on read: any caller that asks for a token gets a valid one
 * or a clear error, and never a 401 halfway through a sync.
 *
 * NOTE: the response shapes below are typed loosely on purpose and every field
 * read goes through a guard. GoHighLevel changes payloads without notice, and
 * these mappings have not been checked against a live account — verify against
 * a real location before trusting a first run.
 */
import { ghlCredentials } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * How long one refresher may hold the lease before another may assume it died.
 * A token exchange is a single HTTP call, so this is generous.
 */
const REFRESH_LEASE_MS = 30 * 1000;

/** How long a waiting caller will poll for someone else's refresh to land. */
const LEASE_WAIT_ATTEMPTS = 6;
const LEASE_WAIT_INTERVAL_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface GhlToken {
  accessToken: string;
  locationId: string | null;
  companyId: string | null;
  /** When this token dies. Callers that cache it need this, not expires_in. */
  expiresAt: string | null;
}

interface TokenRefreshResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Returns a valid access token, refreshing it first if it is close to expiry.
 * Pass null for the agency-level token.
 */
export async function getToken(clientId: string | null): Promise<GhlToken> {
  const db = serviceClient();
  const env = ghlCredentials();

  const query = db.from('oauth_tokens').select('*').eq('provider', 'gohighlevel');
  const { data, error } = clientId
    ? await query.eq('client_id', clientId).maybeSingle()
    : await query.is('client_id', null).maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error(
      clientId
        ? `No GoHighLevel token stored for client ${clientId}. Connect it in settings.`
        : 'No agency-level GoHighLevel token stored. Connect the app first.',
    );
  }

  const meta = (data.meta ?? {}) as Record<string, unknown>;
  const companyId =
    typeof meta['companyId'] === 'string' ? meta['companyId'] : null;

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  const stillValid = expiresAt - Date.now() > REFRESH_MARGIN_MS;

  if (stillValid || !data.refresh_token) {
    return {
      accessToken: data.access_token,
      locationId: data.crm_location_id,
      companyId,
      expiresAt: data.expires_at,
    };
  }

  // GoHighLevel invalidates a refresh token the moment it is used. If two
  // callers refresh at once, the loser is left holding a dead token and that
  // client stops syncing until someone reconnects by hand. So exactly one
  // caller takes a lease; the rest wait for its result.
  const leaseCutoff = new Date(Date.now() - REFRESH_LEASE_MS).toISOString();
  const claim = await db
    .from('oauth_tokens')
    .update({ refreshed_at: new Date().toISOString() })
    .eq('id', data.id)
    .or(`refreshed_at.is.null,refreshed_at.lt.${leaseCutoff}`)
    .select('id');

  if (claim.error) throw claim.error;

  const holdsLease = (claim.data ?? []).length > 0;

  if (!holdsLease) {
    // Someone else is mid-refresh. Poll for the token they are about to write.
    for (let attempt = 0; attempt < LEASE_WAIT_ATTEMPTS; attempt += 1) {
      await sleep(LEASE_WAIT_INTERVAL_MS);

      const reread = await db
        .from('oauth_tokens')
        .select('access_token, expires_at, crm_location_id')
        .eq('id', data.id)
        .maybeSingle();


      if (reread.error) throw reread.error;

      const freshExpiry = reread.data?.expires_at
        ? new Date(reread.data.expires_at).getTime()
        : 0;

      if (reread.data && freshExpiry - Date.now() > REFRESH_MARGIN_MS) {
        return {
          accessToken: reread.data.access_token,
          locationId: reread.data.crm_location_id,
          companyId,
          expiresAt: reread.data.expires_at,
        };
      }
    }

    throw new Error(
      'Timed out waiting for another process to refresh the GoHighLevel ' +
        `token for ${clientId ? `client ${clientId}` : 'the agency'}.`,
    );
  }

  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: data.refresh_token,
  });

  const response = await fetch(`${env.apiBase}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    // Leave a trail on the row so a dead token is visible in settings rather
    // than only in a log nobody reads.
    await db
      .from('oauth_tokens')
      .update({
        refreshed_at: new Date().toISOString(),
        last_error: `refresh failed ${response.status}: ${detail.slice(0, 500)}`,
      })
      .eq('id', data.id);

    throw new Error(
      `GoHighLevel token refresh failed (${response.status}) for ` +
        `${clientId ? `client ${clientId}` : 'the agency token'}.`,
    );
  }

  const payload = (await response.json()) as TokenRefreshResponse;
  if (!payload.access_token) {
    throw new Error('GoHighLevel refresh returned no access_token.');
  }

  const expiresIn = payload.expires_in ?? 86_400;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  await db
    .from('oauth_tokens')
    .update({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token ?? data.refresh_token,
      expires_at: expiresAt,
      refreshed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('id', data.id);

  return {
    accessToken: payload.access_token,
    locationId: data.crm_location_id,
    companyId,
    expiresAt,
  };
}

async function request<T>(
  token: string,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const env = ghlCredentials();
  const url = new URL(`${env.apiBase}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: env.apiVersion,
      Accept: 'application/json',
    },
    // Sync data is never cached: the whole point is that it is fresh.
    cache: 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `GoHighLevel ${path} responded ${response.status}: ${detail.slice(0, 300)}`,
    );
  }

  return (await response.json()) as T;
}

export interface GhlLocation {
  id: string;
  name: string;
  timezone: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Every sub-account under the agency. */
export async function listLocations(): Promise<GhlLocation[]> {
  const { accessToken, companyId } = await getToken(null);

  const payload = await request<{ locations?: unknown[] }>(
    accessToken,
    '/locations/search',
    companyId ? { companyId, limit: '500' } : { limit: '500' },
  );

  const rows = Array.isArray(payload.locations) ? payload.locations : [];

  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const record = row as Record<string, unknown>;
    const id = asString(record['id']);
    const name = asString(record['name']);
    if (!id || !name) return [];

    return [
      {
        id,
        name,
        timezone: asString(record['timezone']),
        email: asString(record['email']),
        phone: asString(record['phone']),
        website: asString(record['website']),
      },
    ];
  });
}

export interface GhlAppointment {
  id: string;
  contactId: string | null;
  calendarId: string | null;
  title: string | null;
  /** UTC ISO. GoHighLevel sends zoned strings; normalised on the way in. */
  startsAt: string;
  endsAt: string | null;
  /** Raw status string, mapped to our enum by the sync. */
  status: string | null;
  appointmentStatus: string | null;
  assignedUserId: string | null;
  address: string | null;
  createdAt: string | null;
}

/**
 * Calendar events for one location in a window. The window is required: asking
 * for everything is how a sync starts timing out in month three.
 */
export async function listAppointments(
  clientId: string,
  locationId: string,
  from: Date,
  to: Date,
): Promise<GhlAppointment[]> {
  const { accessToken } = await getToken(clientId);

  const payload = await request<{ events?: unknown[] }>(
    accessToken,
    '/calendars/events',
    {
      locationId,
      startTime: String(from.getTime()),
      endTime: String(to.getTime()),
    },
  );

  const rows = Array.isArray(payload.events) ? payload.events : [];

  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const record = row as Record<string, unknown>;

    const id = asString(record['id']);
    const startsAtRaw = asString(record['startTime']);
    if (!id || !startsAtRaw) return [];

    const startsAt = new Date(startsAtRaw);
    if (Number.isNaN(startsAt.getTime())) return [];

    const endsAtRaw = asString(record['endTime']);
    const endsAt = endsAtRaw ? new Date(endsAtRaw) : null;

    return [
      {
        id,
        contactId: asString(record['contactId']),
        calendarId: asString(record['calendarId']),
        title: asString(record['title']),
        // Stored UTC. Rendering in the client's zone happens in the UI.
        startsAt: startsAt.toISOString(),
        endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt.toISOString() : null,
        status: asString(record['status']),
        appointmentStatus: asString(record['appointmentStatus']),
        assignedUserId: asString(record['assignedUserId']),
        address: asString(record['address']),
        createdAt: asString(record['dateAdded']),
      },
    ];
  });
}

export interface GhlContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  attribution: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
    adId: string | null;
    campaignId: string | null;
  };
}

/** One contact, for the name and the attribution on a booking. */
export async function getContact(
  clientId: string,
  contactId: string,
): Promise<GhlContact | null> {
  const { accessToken } = await getToken(clientId);

  const payload = await request<{ contact?: unknown }>(
    accessToken,
    `/contacts/${contactId}`,
  );

  if (typeof payload.contact !== 'object' || payload.contact === null) {
    return null;
  }

  const record = payload.contact as Record<string, unknown>;
  const attributions = Array.isArray(record['attributions'])
    ? (record['attributions'] as unknown[])
    : [];
  const first =
    attributions.length > 0 && typeof attributions[0] === 'object'
      ? (attributions[0] as Record<string, unknown>)
      : {};

  const name =
    asString(record['contactName']) ??
    [asString(record['firstName']), asString(record['lastName'])]
      .filter(Boolean)
      .join(' ') ||
    null;

  return {
    id: contactId,
    name,
    email: asString(record['email']),
    phone: asString(record['phone']),
    source: asString(record['source']),
    attribution: {
      utmSource: asString(first['utmSource']),
      utmMedium: asString(first['utmMedium']),
      utmCampaign: asString(first['campaign']),
      utmContent: asString(first['utmContent']),
      utmTerm: asString(first['utmTerm']),
      adId: asString(first['adId']),
      campaignId: asString(first['campaignId']),
    },
  };
}
