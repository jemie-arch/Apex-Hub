/**
 * Hands a valid GoHighLevel access token to another system — in practice, Make.
 *
 * This app is the single owner of GHL tokens. It is the only thing that calls
 * the refresh endpoint, so the refresh token is only ever rotated in one place.
 * Everything else asks here and gets a token that is already valid, which is
 * why there is no second copy to go stale.
 *
 *   GET /api/tokens/ghl                     the agency token
 *   GET /api/tokens/ghl?location=<id>       that location's token
 *   GET /api/tokens/ghl?client=<uuid>       the same, by client id
 *
 * TWO CONSUMERS IN MAKE, and the second is why this matters more than it looks.
 *
 * "GHL Token Bridge (app-owned)" calls it every six hours and caches the agency
 * token in a Make data store.
 *
 * Scenario 5560467, the call transcription flow, used to mint its own location
 * token by POSTing to GoHighLevel's oauth/location-token with a Make OAuth
 * connection called "GHL OAuth App". That connection was authorised by somebody
 * who has since left the company, GoHighLevel began answering "UnAuthorized!",
 * and because Make deactivates an instant-trigger scenario on its first error
 * the whole flow switched itself off — taking the RAW DATA tab that agent pay is
 * calculated from with it.
 *
 * Pointing that module here removes the dependency rather than re-creating it
 * under a new owner: this app holds the refresh token, is the only thing that
 * rotates it, and belongs to no individual. That is the general fix for the 109
 * Make connections whose author no longer exists.
 *
 * Authorisation: Authorization: Bearer <SERVICE_API_KEY>.
 *
 * This route returns a live credential, so it is deliberately narrow: bearer
 * only, no cookie fallback, no CORS, never cached, and the token is never
 * logged.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { authorisedByServiceKey } from '@/lib/auth/service-key';
import { getToken } from '@/lib/integrations/ghl';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let allowed: boolean;
  try {
    allowed = authorisedByServiceKey(request);
  } catch (error) {
    // SERVICE_API_KEY missing: say so rather than returning a bare 401 that
    // would look like a wrong key.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'not configured' },
      { status: 503 },
    );
  }

  if (!allowed) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const locationId = request.nextUrl.searchParams.get('location');
  const clientParam = request.nextUrl.searchParams.get('client');

  let clientId: string | null = null;

  if (clientParam) {
    clientId = clientParam;
  } else if (locationId) {
    const match = await serviceClient()
      .from('clients')
      .select('id')
      .eq('crm_location_id', locationId)
      .maybeSingle();

    if (match.error) {
      return NextResponse.json({ error: match.error.message }, { status: 500 });
    }
    if (!match.data) {
      return NextResponse.json(
        { error: `no client is mapped to location ${locationId}` },
        { status: 404 },
      );
    }

    clientId = match.data.id;
  }

  try {
    const token = await getToken(clientId);

    return NextResponse.json(
      {
        access_token: token.accessToken,
        expires_at: token.expiresAt,
        location_id: token.locationId,
        company_id: token.companyId,
        /*
         * camelCase duplicates, for Make.
         *
         * Scenario 5560467 replaces its own oauth/location-token call with this
         * route, and the two modules downstream of it already read
         * {{106.data.locationId}} and {{106.data.access_token}}. Emitting
         * locationId alongside location_id means only ONE module in that live
         * scenario has to change instead of three — and every module not
         * touched is a mapping that cannot be broken by hand.
         *
         * Additive on purpose. The existing snake_case fields stay, so the GHL
         * Token Bridge scenario, which reads {{1.data.access_token}}, is
         * unaffected.
         */
        locationId: token.locationId,
        companyId: token.companyId,
      },
      {
        status: 200,
        // A credential must not sit in a shared cache.
        headers: { 'cache-control': 'no-store, private' },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'token unavailable' },
      { status: 502 },
    );
  }
}
