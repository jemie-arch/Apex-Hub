/**
 * Route authorisation. This is the only place roles are enforced — a component
 * may style itself differently per role, but it never decides access.
 *
 * Roles, as three kinds rather than a list — see config/roles.ts:
 *   privileged   super_admin and admin. Every route.
 *   staff        every other job role. Whichever pages an admin granted them
 *                in user_profiles.permissions, plus their own call-centre page.
 *   client       bounced to their own portal; they do not get the internal app.
 *
 * Matched by predicate, never by naming roles. A role named here and nowhere
 * else is a role that 404s on every page the day somebody is given it.
 *
 * /portal/[token] is deliberately unauthenticated. It is safe because the page
 * resolves the token to exactly one client server-side and scopes every query
 * to that id — changing the URL yields a different token, which resolves to
 * nothing rather than to a neighbour's records.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isCallerRole, isPrivileged, isStaffRole } from '@/config/roles';

import { firstAllowedRoute, permissionForPath } from '@/config/permissions';

/** Reachable without a session. */
const PUBLIC_PREFIXES = [
  '/login',
  '/auth',
  '/portal',
  '/api/portal',
  '/api/auth',
  // The Kick-Off and Post Close forms. A practice fills the Post Close form
  // before it has access to anything, so a login here is impossible by design.
  '/f',
];

/**
 * Guarded by a shared secret in the route itself, not by a session. These are
 * machine-to-machine: Vercel cron and Make.
 */
const SECRET_PREFIXES = [
  '/api/sync',
  '/api/cron',
  '/api/tokens',
  '/api/health',
  // Inbound recorder webhook: checks CRON_SECRET in the route itself.
  '/api/webhooks',
  /*
   * The @apex ticket bot. Slack cannot carry a session cookie or a bearer
   * token — it posts to a URL configured once in the app and decides for
   * itself what it sends — so this route authenticates by request signature
   * instead, in lib/slack/signature.
   *
   * It has to be listed here. Without it middleware sees an unauthenticated
   * POST and redirects to /login, Slack reads the 307 as a failed delivery,
   * and after enough of them it disables the endpoint. No ticket would ever be
   * filed and nothing in the app would record why.
   */
  '/api/slack',
];

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (startsWithAny(pathname, SECRET_PREFIXES)) {
    return NextResponse.next();
  }
  if (startsWithAny(pathname, PUBLIC_PREFIXES)) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Checked rather than asserted with `!`. Passing an empty URL to
  // createServerClient throws inside middleware, and Vercel renders that as an
  // opaque MIDDLEWARE_INVOCATION_FAILED with no clue what is wrong. Say it.
  if (!supabaseUrl || !supabaseAnonKey) {
    return new NextResponse(
      'Configuration incomplete: NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in the deployment ' +
        'environment, then redeployed.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  // Carry refreshed auth cookies through to the response.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }>,
        ) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser(), not getSession(): this revalidates against the auth server, so a
  // revoked or tampered token does not survive here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  const role = (user.app_metadata?.['role'] as string | undefined) ?? 'client';

  if (isPrivileged(role)) {
    return response;
  }

  if (role === 'client') {
    // A client login does not belong in the internal app. Hand it to the route
    // that resolves their portal token server-side and redirects.
    const portal = request.nextUrl.clone();
    portal.pathname = '/api/portal/me';
    portal.search = '';
    return NextResponse.redirect(portal);
  }

  /*
   * Every other member of staff: exactly the pages an admin has granted them,
   * and their own call-centre performance page. The grant is read from the
   * profile rather than the JWT, because a revoked page has to stop working now
   * and not whenever the token next refreshes.
   *
   * One rule survives regardless of grants — nobody reaches a colleague's
   * drill-down, because that page is about a named individual.
   *
   * This deliberately covers ALL non-privileged staff rather than naming roles.
   * It used to test for isr and csr only, which meant the five job roles added
   * for hiring — ceo, tech, media_buyer, isa, csm — would each have fallen
   * through to the 404 below and been locked out of the whole app on their first
   * sign-in. That is the second time the same shape of bug has bitten: a role
   * existing in the database that the routing has never heard of.
   */
  if (isStaffRole(role)) {
    const ownPage = `/call-center/${user.id}`;

    if (pathname === ownPage || pathname.startsWith(`${ownPage}/`)) {
      return response;
    }

    // 404 rather than 403, so the URL does not confirm the colleague exists.
    if (pathname.startsWith('/call-center/')) {
      return new NextResponse('Not found', { status: 404 });
    }

    const profile = await supabase
      .from('user_profiles')
      .select('permissions')
      .eq('id', user.id)
      .maybeSingle();

    const granted: string[] = profile.data?.permissions ?? [];

    // The landing page depends on what they hold, so nobody arrives at a 404
    // by signing in. A caller goes to their own performance page; everybody else
    // goes to the first page they can actually open, which for a media buyer or
    // a tech is not the call centre.
    if (pathname === '/') {
      const isCaller = isCallerRole(role);
      const home = request.nextUrl.clone();
      home.pathname =
        firstAllowedRoute(granted) ?? (isCaller ? ownPage : '/account');
      home.search = '';
      return NextResponse.redirect(home);
    }

    const required = permissionForPath(pathname);
    if (required !== null && granted.includes(required)) {
      return response;
    }

    return new NextResponse('Not found', { status: 404 });
  }

  /*
   * Any staff role with no rule above lands here.
   *
   * This 404 locked the owner out of the entire app once: the database gave them
   * a new privileged role before the code that recognises it was deployed, and
   * every path fell through to here. Roles are defined in config/roles.ts, so a
   * new one must be added to PRIVILEGED_ROLES or handled explicitly above
   * BEFORE it is assigned to anybody.
   */
  return new NextResponse('Not found', { status: 404 });
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static files. Auth and portal paths
     * are allowed through in the handler above rather than excluded here, so
     * that adding a public route is a one-line change in one place.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
