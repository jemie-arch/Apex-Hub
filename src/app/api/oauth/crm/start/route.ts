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

// Without this, Next prerenders the route at build time, which calls
// ghlCredentials() and fails the build on a machine that has no CRM
// credentials. The env check belongs at request time, not compile time.
export const dynamic = 'force-dynamic';

// The /v2/ path is the one the marketplace itself generates and which
// demonstrably renders the install screen; the unversioned path is older.
const AUTHORIZE_URL =
  'https://marketplace.gohighlevel.com/v2/oauth/chooselocation';

const SCOPES = [
  'locations.readonly',
  'calendars.readonly',
  'calendars/events.readonly',
  'contacts.readonly',
  'opportunities.readonly',
  'users.readonly',
  'conversations.readonly',
  'conversations/message.readonly',
  // Required to mint per-location tokens from the agency install via
  // /oauth/locationToken. Without these the agency token authenticates fine
  // and then every mint fails — which is a confusing place to discover a
  // missing scope, because the connection itself looks healthy.
  'oauth.readonly',
  'oauth.write',
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

  // Private marketplace apps pin the install to a specific app version. The
  // marketplace's own link includes it, so mirror that when it is configured.
  const versionId = process.env.GHL_APP_VERSION_ID?.trim();
  if (versionId) url.searchParams.set('version_id', versionId);

  return NextResponse.redirect(url);
}
