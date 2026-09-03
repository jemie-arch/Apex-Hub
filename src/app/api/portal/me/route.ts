/**
 * Sends a client login to their own portal.
 *
 * Middleware has redirected every `role === 'client'` request here since roles
 * were introduced, and this route did not exist — so a client signing in got a
 * bare 404, and so did any member of staff whose token predated their role
 * being set. That is what happened tonight: a CEO created in the Supabase UI
 * held a JWT with no role, defaulted to 'client', and was sent to a route
 * nobody had built.
 *
 * The portal is reached by token rather than by session, so this resolves the
 * token server-side and redirects. The token never passes through the client's
 * hands as something they could edit, and it never appears in a page they could
 * bookmark wrongly.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { createServerClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();

  /*
   * The caller's own session, not the service key. This route decides where to
   * send whoever is asking, so it must read the asker rather than trust a
   * parameter.
   */
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: () => {
        /* read-only: this route redirects and sets no session */
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const login = new URL('/login', request.url);

  if (!user) return NextResponse.redirect(login);

  const role = (user.app_metadata?.['role'] as string | undefined) ?? 'client';

  /*
   * Staff who arrive here are the reason this was a 404 rather than a
   * redirect loop.
   *
   * A token minted before somebody's role was set says 'client', so middleware
   * sends them here. Sending them back to the app would bounce between the two
   * forever, and sending them to the portal would be wrong -- they have no
   * client. So this says plainly what is wrong and how to clear it, because
   * "sign out and back in" is the fix and nothing on a 404 page could have told
   * them that.
   */
  if (role !== 'client') {
    return new NextResponse(
      'Your sign-in is out of date. Sign out and sign in again to pick up your ' +
        'current access, then you will be taken to the right page.',
      { status: 409, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const groupId = (user.app_metadata?.['group_id'] as string | undefined) ?? '';

  if (groupId.trim() === '') {
    return new NextResponse(
      'This login is not linked to a practice yet, so there is no portal to ' +
        'open. Ask Apex to finish setting the account up.',
      { status: 409, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  /*
   * Service client for the token itself. A client may not read client_groups --
   * that is the whole point of the portal being token-addressed -- so the
   * lookup runs with the service key and only ever returns this one group's
   * token.
   */
  const group = await serviceClient()
    .from('client_groups')
    .select('portal_token, portal_enabled')
    .eq('id', groupId)
    .maybeSingle();

  if (group.error || !group.data || !group.data.portal_enabled) {
    return new NextResponse(
      'Your portal is not switched on. Ask Apex to enable it.',
      { status: 409, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  return NextResponse.redirect(new URL(`/portal/${group.data.portal_token}`, request.url));
}
