/**
 * Where the Hub lives, for links written into places that are not the Hub.
 *
 * NEXT_PUBLIC_APP_URL when somebody set it, the Vercel-provided origin
 * otherwise, and null in local development where neither exists — a link to
 * localhost posted into Slack is worse than no link, because it looks like it
 * should work.
 *
 * One copy. This logic was inline in lib/notify/slack.ts and was about to be
 * inline in the Slack events route as well, which is two places to get a
 * trailing slash wrong in.
 */
export function hubUrl(path = '/'): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  const origin = explicit
    ? explicit.replace(/\/$/, '')
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : null;

  if (origin === null) return null;

  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}
