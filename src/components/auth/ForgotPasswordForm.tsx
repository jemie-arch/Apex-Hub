'use client';

/**
 * Asking for your own set-password link.
 *
 * This exists because of how the previous arrangement failed. An admin
 * generated a single-use link in Settings and sent it over Slack or email, and
 * the recipient reliably got "This link has expired" — because Slack, Teams,
 * Outlook and Gmail all fetch a URL to build a preview or scan it for malware,
 * and that fetch spends the one-time token seconds after it is pasted. The
 * person then clicks a link that was already used.
 *
 * Requesting it yourself removes the hop where that happens: the link goes to
 * your own inbox and you click it in the same session. Nobody forwards
 * anything, so nothing gets a chance to consume it on the way.
 *
 * Always reports success. A form that says "no account with that address" tells
 * anyone who asks which addresses are real, and this page is public.
 */
import { MailCheck } from 'lucide-react';
import { useState } from 'react';

import { requestSetPasswordEmail } from '@/app/auth/forgot/actions';
import { Button } from '@/components/ui/Button';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <div className="rounded-lg border border-line bg-surface p-6">
        <MailCheck className="text-positive" size={22} />
        <h1 className="mt-3 text-lg font-semibold text-fg">Check your email</h1>
        <p className="mt-2 text-sm text-fg-muted">
          If there is an account for that address, a link to set your password is
          on its way. It is single use, so open it from your own inbox rather
          than forwarding it on.
        </p>
        <p className="mt-3 text-sm text-fg-subtle">
          Nothing after a few minutes? Check spam, then ask for another — asking
          again is free and the newest link is the one that works.
        </p>
        <a
          href="/login"
          className="mt-5 inline-block text-sm font-medium text-accent hover:underline"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form
      className="rounded-lg border border-line bg-surface p-6"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        setBusy(true);
        const result = await requestSetPasswordEmail({ email });
        setBusy(false);
        if (result.ok) setSent(true);
        else setError(result.message);
      }}
    >
      <h1 className="text-lg font-semibold text-fg">Set your password</h1>
      <p className="mt-2 text-sm text-fg-muted">
        New here, or forgotten it? Put in your work email and we will send you a
        link.
      </p>

      <label className="mt-5 block text-sm font-medium text-fg" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg"
      />

      {error ? (
        <p className="mt-4 rounded-md bg-negative-subtle px-3 py-2 text-sm text-negative">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="primary" className="mt-5 w-full" disabled={busy}>
        {busy ? 'Sending…' : 'Send me a link'}
      </Button>

      <a
        href="/login"
        className="mt-4 block text-center text-sm text-fg-muted hover:underline"
      >
        Back to sign in
      </a>
    </form>
  );
}
