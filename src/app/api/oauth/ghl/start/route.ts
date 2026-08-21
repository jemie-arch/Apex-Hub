/**
 * Begins the GoHighLevel OAuth handshake.
 *
 * Not public: middleware only lets an admin session reach /api/oauth/*, so a
 * stranger cannot start a flow that would attach a token to this database.
 *
 * Connect the agency ("Company") once, then each location whose bookings you
 * want. The agency token lists locations; a location token reads its calendar.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { ghlCredentials } from '@/lib/env';

const AUTHORIZE_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';

const SCOPES = [
  'locations.readonly',
  'calendars.readonly',
  'calendars/events.readonly',
  'contacts.readonly',
  'opportunities.readonly',
  'users.readonly',
];

export function GET(request: NextRequest) {
  const env = ghlCredentials();

  // 'Company' for the agency token, 'Location' for a single sub-account.
  const userType =
    request.nextUrl.searchParams.get('userType') === 'Location'
      ? 'Location'
      : 'Company';

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.clientId);
  url.searchParams.set('redirect_uri', env.redirectUri);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('userType', userType);

  return NextResponse.redirect(url);
}
