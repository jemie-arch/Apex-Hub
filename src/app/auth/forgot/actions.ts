'use server';

/**
 * Sending somebody their own set-password link.
 *
 * Deliberately not the admin generateLink path used in Settings. That one
 * returns a link for a human to forward, and forwarding is exactly where it
 * broke: Slack, Teams, Outlook and Gmail fetch a URL to preview or scan it, and
 * that fetch spends the single-use token before the recipient clicks. This
 * sends the mail to the address itself, so the only fetch that matters is the
 * one the person makes.
 *
 * Uses the anon client, not the service client. This is an unauthenticated,
 * publicly reachable action, and it should have exactly the authority a signed
 * -out visitor has — no more. resetPasswordForEmail is designed for that.
 */
import { createClient } from '@supabase/supabase-js';

import { publicEnv } from '@/lib/env';

export interface ForgotResult {
  ok: boolean;
  message: string;
}

/**
 * Where the link should land, same resolution the admin path uses.
 *
 * A wrong origin here sends somebody to a working link on a site that is not
 * this one, which looks identical to an expired link from the outside.
 */
function siteOrigin(): string | null {
  const configured = process.env['NEXT_PUBLIC_APP_URL']?.trim();
  if (configured) return configured.replace(/\/$/, '');

  const vercel =
    process.env['VERCEL_PROJECT_PRODUCTION_URL'] ?? process.env['VERCEL_URL'];
  return vercel ? `https://${vercel}` : null;
}

export async function requestSetPasswordEmail(input: {
  email: string;
}): Promise<ForgotResult> {
  const email = input.email.trim().toLowerCase();

  /*
   * The only failure this reports honestly is a malformed address, because that
   * is the sender's own typo rather than a fact about somebody else's account.
   */
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: 'That does not look like an email address.' };
  }

  const origin = siteOrigin();
  if (origin === null) {
    return {
      ok: false,
      message:
        'This site is not configured to send links. Tell an admin that ' +
        'NEXT_PUBLIC_APP_URL is unset.',
    };
  }

  const supabase = createClient(
    publicEnv().supabaseUrl,
    publicEnv().supabaseAnonKey,
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/set-password`,
  });

  /*
   * Reported as success even when Supabase objects.
   *
   * A form that distinguishes "sent" from "no such account" tells anyone who
   * asks which addresses are real, and this page is public. Rate limits also
   * surface here, and telling a legitimate person "too many requests" while
   * telling an enumerator "no such user" is the wrong way round: the first is
   * unhelpful, the second is a leak.
   *
   * Genuine faults are still visible in the Supabase auth logs, which is where
   * somebody debugging this should look rather than at the screen.
   */
  if (error) {
    console.error('resetPasswordForEmail failed', {
      message: error.message,
      status: error.status,
    });
  }

  return {
    ok: true,
    message: 'If there is an account for that address, a link is on its way.',
  };
}
