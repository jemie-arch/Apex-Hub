'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { tenant } from '@/config/tenant.config';
import { browserClient } from '@/lib/supabase/browser';

export default function LoginPage() {
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

    const { error: signInError } = await browserClient().auth.signInWithPassword(
      { email, password },
    );

    if (signInError) {
      // Deliberately vague: do not confirm whether an address has an account.
      setError('Those details were not accepted.');
      setBusy(false);
      return;
    }

    // Middleware decides where this person is allowed to land.
    router.replace(searchParams.get('next') ?? '/dashboard');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-sm font-semibold text-accent-contrast"
            aria-hidden
          >
            {tenant.company.initial}
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">
              {tenant.company.name}
            </p>
            <p className="text-xs text-fg-subtle">{tenant.company.tagline}</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-line bg-surface p-6 shadow-sm"
        >
          <h1 className="text-lg font-semibold text-fg">Sign in</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Internal access only.
          </p>

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
      </div>
    </main>
  );
}
