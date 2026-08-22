'use client';

/**
 * Split out from the page because it calls useSearchParams(), which forces a
 * client-side bailout. Kept behind a Suspense boundary in page.tsx so the
 * route still builds instead of failing prerender.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { browserClient } from '@/lib/supabase/browser';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    let client;
    try {
      client = browserClient();
    } catch {
      // Missing NEXT_PUBLIC_* configuration throws here, before any request is
      // made. Without this the button simply did nothing, which is
      // indistinguishable from a wrong password.
      setError(
        'This deployment is not configured yet — its Supabase keys are ' +
          'missing. Nothing is wrong with your details.',
      );
      setBusy(false);
      return;
    }

    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // Deliberately vague about which half was wrong: do not confirm whether
      // an address has an account.
      setError('Those details were not accepted.');
      setBusy(false);
      return;
    }

    // Middleware decides where this person is allowed to land.
    router.replace(searchParams.get('next') ?? '/dashboard');
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="panel rounded-lg border border-line bg-surface p-6"
    >
      <h1 className="text-lg font-semibold text-fg">Sign in</h1>
      <p className="mt-1 text-sm text-fg-muted">Internal access only.</p>

      <label className="mt-5 block text-sm font-medium text-fg" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg"
      />

      <label
        className="mt-4 block text-sm font-medium text-fg"
        htmlFor="password"
      >
        Password
      </label>
      <input
        id="password"
        type="password"
        required
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg"
      />

      {error ? (
        <p className="mt-4 rounded-md bg-negative-subtle px-3 py-2 text-sm text-negative">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        className="mt-5 w-full"
        disabled={busy}
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
