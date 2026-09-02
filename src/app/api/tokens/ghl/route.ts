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
