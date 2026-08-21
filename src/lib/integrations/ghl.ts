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
    // A marketplace app installed at agency level can mint a token for any of
    // its locations, so a missing per-location row is not a dead end — it just
    // has not been minted yet. Only the agency token requires a human.
    if (clientId) return mintLocationToken(clientId);

    throw new Error(
      'No agency-level GoHighLevel token stored. Connect the app in settings.',
    );
  }

  const meta = (data.meta ?? {}) as Record<string, unknown>;
  const companyId =
    typeof meta['companyId'] === 'string' ? meta['companyId'] : null;

  // Named ...Ms because it is a timestamp, and because a later `expiresAt`
  // in this same function holds the new ISO expiry. Two `const expiresAt`
  // declarations in one scope is a SyntaxError, not a shadow.
  const expiresAtMs = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  const stillValid = expiresAtMs - Date.now() > REFRESH_MARGIN_MS;

  if (stillValid) {
    return {
      accessToken: data.access_token,
      locationId: data.crm_location_id,
      companyId,
      expiresAt: data.expires_at,
    };
  }

  // Expired with no refresh token. Location tokens minted from the agency
  // install come without one by design, so the answer is to mint a fresh one
  // rather than to hand back something already dead.
  if (!data.refresh_token) {
    if (clientId) return mintLocationToken(clientId);

    throw new Error(
      'The agency GoHighLevel token has expired and has no refresh token. ' +
        'Reconnect the app in settings.',
    );
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

/**
 * Mints a location access token from the agency install.
 *
 * This is the whole point of installing as a marketplace app at agency level:
 * one Company token can issue a token for any location under it, so 45
 * practices do not need 45 separate OAuth handshakes.
 *
 * Tokens minted this way carry no refresh token — they are cheap to reissue,
 * so getToken re-mints on expiry instead of refreshing.
 *
 * NOTE: unverified against a live agency install. The endpoint and field names
 * follow GoHighLevel's documented shape; confirm with one location before
 * trusting a bulk run.
 */
export async function mintLocationToken(clientId: string): Promise<GhlToken> {
  const db = serviceClient();
  const env = ghlCredentials();

  const client = await db
    .from('clients')
    .select('id, name, crm_location_id')
    .eq('id', clientId)
    .maybeSingle();

  if (client.error) throw client.error;
  if (!client.data?.crm_location_id) {
    throw new Error(
      `Client ${clientId} has no crm_location_id, so no token can be minted.`,
    );
  }

  const locationId = client.data.crm_location_id;
  const agency = await getToken(null);

  if (!agency.companyId) {
    throw new Error(
      'The agency token has no companyId stored, which /oauth/locationToken ' +
        'requires. Reconnect the agency install so the companyId is captured.',
    );
  }

  const response = await fetch(`${env.apiBase}/oauth/locationToken`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agency.accessToken}`,
      Version: env.apiVersion,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      companyId: agency.companyId,
      locationId,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Could not mint a token for ${client.data.name} (${locationId}): ` +
        `${response.status} ${detail.slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!payload.access_token) {
    throw new Error(
      `Minting a token for ${client.data.name} returned no access_token.`,
    );
  }

  const expiresAt = new Date(
    Date.now() + (payload.expires_in ?? 86_400) * 1000,
  ).toISOString();

  const record = {
    provider: 'gohighlevel',
    client_id: clientId,
    crm_location_id: locationId,
    access_token: payload.access_token,
    // Minted tokens have none; expiry is handled by re-minting.
    refresh_token: null,
    expires_at: expiresAt,
    scope: payload.scope ?? null,
    refreshed_at: new Date().toISOString(),
    last_error: null,
    meta: { mintedFromAgency: true, companyId: agency.companyId },
  };

  // Upsert by hand: uniqueness is a partial index, which ON CONFLICT cannot
  // target.
  const existing = await db
    .from('oauth_tokens')
    .select('id')
    .eq('provider', 'gohighlevel')
    .eq('client_id', clientId)
    .maybeSingle();

  if (existing.error) throw existing.error;

  const written = existing.data
    ? await db.from('oauth_tokens').update(record).eq('id', existing.data.id)
    : await db.from('oauth_tokens').insert(record);

  if (written.error) throw written.error;

  return {
    accessToken: payload.access_token,
    locationId,
    companyId: agency.companyId,
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

export interface GhlCalendar {
  id: string;
  name: string | null;
}

/** Calendars belonging to one location. */
export async function listCalendars(
  clientId: string,
  locationId: string,
): Promise<GhlCalendar[]> {
  const { accessToken } = await getToken(clientId);

  const payload = await request<{ calendars?: unknown[] }>(
    accessToken,
    '/calendars/',
    { locationId },
  );

  const rows = Array.isArray(payload.calendars) ? payload.calendars : [];

  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const record = row as Record<string, unknown>;
    const id = asString(record['id']);
    if (!id) return [];
    return [{ id, name: asString(record['name']) }];
  });
}

/**
 * How many calendars per location to read. A practice usually has a handful
 * (one per treatment type); the cap stops one misconfigured location with
 * dozens from consuming the whole function timeout.
 */
const MAX_CALENDARS_PER_LOCATION = 8;

/**
 * Calendar events for one location in a window.
 *
 * /calendars/events will not accept a location alone — it answers 422 with
 * "Either of userId, calendarId or groupId is required" — so this lists the
 * location's calendars first and asks per calendar. The window is required
 * too: asking for everything is how a sync starts timing out in month three.
 */
export async function listAppointments(
  clientId: string,
  locationId: string,
  from: Date,
  to: Date,
): Promise<GhlAppointment[]> {
  const calendars = await listCalendars(clientId, locationId);
  if (calendars.length === 0) return [];

  const { accessToken } = await getToken(clientId);
  const events: unknown[] = [];

  for (const calendar of calendars.slice(0, MAX_CALENDARS_PER_LOCATION)) {
    const payload = await request<{ events?: unknown[] }>(
      accessToken,
      '/calendars/events',
      {
        locationId,
        calendarId: calendar.id,
        startTime: String(from.getTime()),
        endTime: String(to.getTime()),
      },
    );

    if (Array.isArray(payload.events)) events.push(...payload.events);
  }

  const rows = events;

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

export interface GhlOpportunity {
  id: string;
  contactId: string | null;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** 'open' | 'won' | 'lost' | 'abandoned' in GoHighLevel's vocabulary. */
  status: string | null;
  /** Pipeline stage id; names are per-pipeline and resolved by the sync. */
  stageId: string | null;
  stageName: string | null;
  monetaryValue: number | null;
  assignedUserId: string | null;
  source: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Opportunities for one location — Apex's own sales pipeline, not a practice's.
 * Which location that is comes from app_settings.b2b_location_id, because the
 * agency's pipeline is just another sub-account and only a human knows which.
 */
export async function listOpportunities(
  clientId: string | null,
  locationId: string,
): Promise<GhlOpportunity[]> {
  const { accessToken } = await getToken(clientId);

  const payload = await request<{ opportunities?: unknown[] }>(
    accessToken,
    '/opportunities/search',
    { location_id: locationId, limit: '100' },
  );

  const rows = Array.isArray(payload.opportunities) ? payload.opportunities : [];

  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const record = row as Record<string, unknown>;

    const id = asString(record['id']);
    if (!id) return [];

    const contact =
      typeof record['contact'] === 'object' && record['contact'] !== null
        ? (record['contact'] as Record<string, unknown>)
        : {};

    const monetary = record['monetaryValue'];

    return [
      {
        id,
        contactId: asString(record['contactId']) ?? asString(contact['id']),
        // GoHighLevel names an opportunity, not a company. Falling back to the
        // contact name keeps the row identifiable either way.
        name:
          asString(record['name']) ??
          asString(contact['name']) ??
          'Unnamed opportunity',
        contactName: asString(contact['name']),
        contactEmail: asString(contact['email']),
        contactPhone: asString(contact['phone']),
        status: asString(record['status']),
        stageId: asString(record['pipelineStageId']),
        stageName: asString(record['pipelineStageName']),
        monetaryValue:
          typeof monetary === 'number'
            ? monetary
            : typeof monetary === 'string' && monetary.trim() !== ''
              ? Number.parseFloat(monetary)
              : null,
        assignedUserId: asString(record['assignedTo']),
        source: asString(record['source']),
        createdAt: asString(record['createdAt']) ?? asString(record['dateAdded']),
        updatedAt: asString(record['updatedAt']),
      },
    ];
  });
}

export interface GhlCall {
  id: string;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  userId: string | null;
  /** 'inbound' | 'outbound' */
  direction: string | null;
  /** GoHighLevel's call status: completed, no-answer, busy, voicemail… */
  status: string | null;
  durationSeconds: number;
  startedAt: string;
  recordingUrl: string | null;
}

/**
 * Call logs for one location.
 *
 * NOTE: GoHighLevel exposes calls as messages inside conversations rather than
 * as a call log, so this walks conversations and keeps the call-type messages.
 * That is two requests per conversation, hence the caps in the sync. It is also
 * the least verified mapping in this codebase — check it against one real
 * location before trusting the leaderboard.
 */
export async function listConversationCalls(
  clientId: string,
  locationId: string,
  maxConversations: number,
): Promise<GhlCall[]> {
  const { accessToken } = await getToken(clientId);

  const search = await request<{ conversations?: unknown[] }>(
    accessToken,
    '/conversations/search',
    { locationId, limit: String(maxConversations) },
  );

  const conversations = Array.isArray(search.conversations)
    ? search.conversations
    : [];

  const calls: GhlCall[] = [];

  for (const conversation of conversations) {
    if (typeof conversation !== 'object' || conversation === null) continue;
    const conv = conversation as Record<string, unknown>;

    const conversationId = asString(conv['id']);
    if (!conversationId) continue;

    const contactId = asString(conv['contactId']);
    const contactName = asString(conv['fullName']) ?? asString(conv['contactName']);

    const messages = await request<{ messages?: { messages?: unknown[] } }>(
      accessToken,
      `/conversations/${conversationId}/messages`,
      { limit: '100' },
    );

    const list = Array.isArray(messages.messages?.messages)
      ? messages.messages.messages
      : [];

    for (const message of list) {
      if (typeof message !== 'object' || message === null) continue;
      const msg = message as Record<string, unknown>;

      const type = (asString(msg['messageType']) ?? asString(msg['type']) ?? '')
        .toUpperCase();
      if (!type.includes('CALL')) continue;

      const id = asString(msg['id']);
      const startedRaw = asString(msg['dateAdded']) ?? asString(msg['createdAt']);
      if (!id || !startedRaw) continue;

      const started = new Date(startedRaw);
      if (Number.isNaN(started.getTime())) continue;

      const meta =
        typeof msg['meta'] === 'object' && msg['meta'] !== null
          ? (msg['meta'] as Record<string, unknown>)
          : {};
      const call =
        typeof meta['call'] === 'object' && meta['call'] !== null
          ? (meta['call'] as Record<string, unknown>)
          : {};

      const duration = call['duration'] ?? msg['duration'];

      calls.push({
        id,
        contactId,
        contactName,
        contactPhone: asString(conv['phone']),
        userId: asString(msg['userId']),
        direction: asString(msg['direction']),
        status: asString(call['status']) ?? asString(msg['status']),
        durationSeconds:
          typeof duration === 'number'
            ? Math.max(0, Math.trunc(duration))
            : typeof duration === 'string' && duration.trim() !== ''
              ? Math.max(0, Number.parseInt(duration, 10) || 0)
              : 0,
        startedAt: started.toISOString(),
        recordingUrl: asString(msg['recordingUrl']) ?? asString(call['recordingUrl']),
      });
    }
  }

  return calls;
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
  /** Key names only — see ContactShape. */
  shape: ContactShape;
}

/**
 * What a contact payload actually carried, by key name only.
 *
 * Recorded because "we have no ad attribution" and "we are reading the wrong
 * key" look identical from the database — both leave utm_campaign null across
 * every row. Key names are safe to keep; the values are a patient's details
 * and are deliberately not included.
 */
export interface ContactShape {
  hasAttributions: boolean;
  attributionKeys: string[];
  topLevelKeys: string[];
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

  // Built in two steps on purpose: `a ?? b || c` is a SyntaxError, because
  // mixing ?? with || without parentheses is not allowed.
  const fullName = [asString(record['firstName']), asString(record['lastName'])]
    .filter(Boolean)
    .join(' ');

  const name = asString(record['contactName']) ?? (fullName === '' ? null : fullName);

  return {
    id: contactId,
    name,
    email: asString(record['email']),
    phone: asString(record['phone']),
    source: asString(record['source']),
    shape: {
      hasAttributions: attributions.length > 0,
      attributionKeys: Object.keys(first),
      topLevelKeys: Object.keys(record).filter((key) =>
        /attribut|utm|source|campaign|ad/i.test(key),
      ),
    },
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
