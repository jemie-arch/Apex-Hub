/**
 * Route authorisation. This is the only place roles are enforced — a component
 * may style itself differently per role, but it never decides access.
 *
 * The three roles:
 *   admin      every route
 *   isr / csr  their own performance page and nothing else, not even the
 *              leaderboard that would show them a colleague's numbers
 *   client     bounced to their own portal; they do not get the internal app
 *
 * /portal/[token] is deliberately unauthenticated. It is safe because the page
 * resolves the token to exactly one client server-side and scopes every query
 * to that id — changing the URL yields a different token, which resolves to
 * nothing rather than to a neighbour's records.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Reachable without a session. */
const PUBLIC_PREFIXES = [
  '/login',
  '/auth',
  '/portal',
  '/api/portal',
  '/api/auth',
];

/**
 * Guarded by a shared secret in the route itself, not by a session. These are
 * machine-to-machine: Vercel cron and Make.
 */
const SECRET_PREFIXES = ['/api/sync', '/api/cron', '/api/tokens'];

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

  // Carry refreshed auth cookies through to the response.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  if (role === 'admin') {
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

  // Both call-centre roles get exactly one page: their own. The leaderboard at
  // /call-center would show them a colleague's numbers, so it is not theirs.
  if (role === 'isr' || role === 'csr') {
    const ownPage = `/call-center/${user.id}`;

    if (
      pathname === '/call-center' ||
      pathname === '/dashboard' ||
      pathname === '/'
    ) {
      const own = request.nextUrl.clone();
      own.pathname = ownPage;
      own.search = '';
      return NextResponse.redirect(own);
    }

    if (pathname === ownPage || pathname.startsWith(`${ownPage}/`)) {
      return response;
    }

    // Everything else, including another rep's drill-down. 404 rather than 403
    // so the URL does not confirm that a colleague's page exists.
    return new NextResponse('Not found', { status: 404 });
  }

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
