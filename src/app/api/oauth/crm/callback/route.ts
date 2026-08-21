/**
 * Completes the GoHighLevel handshake and stores the token.
 *
 * A Company token becomes the agency row (client_id null). A Location token is
 * attached to the client whose crm_location_id matches — and if no client
 * matches yet, that is reported rather than guessed at, because a token filed
 * against the wrong client would sync one client's bookings into another's.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { ghlCredentials } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  locationId?: string;
  companyId?: string;
  userType?: string;
}

export async function GET(request: NextRequest) {
  const env = ghlCredentials();
  const code = request.nextUrl.searchParams.get('code');

  if (!code) {
    const denied = request.nextUrl.searchParams.get('error');
    return NextResponse.json(
      { error: denied ?? 'no authorisation code was returned' },
      { status: 400 },
    );
  }

  const response = await fetch(`${env.apiBase}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.redirectUri,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return NextResponse.json(
      { error: `token exchange failed (${response.status})`, detail: detail.slice(0, 500) },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as TokenResponse;
  if (!payload.access_token) {
    return NextResponse.json(
      { error: 'token exchange returned no access_token' },
      { status: 502 },
    );
  }

  const db = serviceClient();
  const isLocation = payload.userType === 'Location' && payload.locationId;

  let clientId: string | null = null;

  if (isLocation && payload.locationId) {
    const match = await db
      .from('clients')
      .select('id, name')
      .eq('crm_location_id', payload.locationId)
      .maybeSingle();

    if (match.error) throw match.error;
    if (!match.data) {
      // Do not invent a client here: run the clients sync with the agency
      // token first, so the row exists with the right name and timezone.
      return NextResponse.json(
        {
          error: 'no client matches this location',
          locationId: payload.locationId,
          fix: 'Run the crm-clients sync with the agency token connected, then retry.',
        },
        { status: 409 },
      );
    }

    clientId = match.data.id;
  }

  const record = {
    provider: 'gohighlevel',
    client_id: clientId,
    crm_location_id: payload.locationId ?? null,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? null,
    expires_at: new Date(
      Date.now() + (payload.expires_in ?? 86_400) * 1000,
    ).toISOString(),
    scope: payload.scope ?? null,
    refreshed_at: new Date().toISOString(),
    last_error: null,
    meta: payload.companyId ? { companyId: payload.companyId } : {},
  };

  // Upserting by hand: the uniqueness rule is two partial indexes (one token
  // per client, one for the agency), which ON CONFLICT cannot target.
  const lookup = db.from('oauth_tokens').select('id').eq('provider', 'gohighlevel');
  const existing = clientId
    ? await lookup.eq('client_id', clientId).maybeSingle()
    : await lookup.is('client_id', null).maybeSingle();

  if (existing.error) throw existing.error;

  const written = existing.data
    ? await db.from('oauth_tokens').update(record).eq('id', existing.data.id)
    : await db.from('oauth_tokens').insert(record);

  if (written.error) {
    return NextResponse.json(
      { error: 'could not store the token', detail: written.error.message },
      { status: 500 },
    );
  }

  const settings = request.nextUrl.clone();
  settings.pathname = '/settings';
  settings.search = `?connected=${isLocation ? 'location' : 'agency'}`;
  return NextResponse.redirect(settings);
}
