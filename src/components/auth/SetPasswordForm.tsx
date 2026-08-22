'use client';

/**
 * Where a set-password link lands.
 *
 * The link carries a one-time token that Supabase exchanges for a session
 * before redirecting here. Two shapes arrive depending on how the project is
 * configured — a hash carrying access_token and refresh_token, or a query
 * carrying code — and both are handled, because a link that works in one
 * configuration and silently fails in the other is worse than one that never
 * works at all.
 *
 * The token is consumed on arrival, so the URL is scrubbed immediately: a
 * back button, a shared screenshot or a synced browser history should not carry
 * a working credential.
 */
import { CheckCircle2, KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { browserClient } from '@/lib/supabase/browser';

type Stage = 'checking' | 'ready' | 'invalid' | 'saved';

const MIN_LENGTH = 10;

export function SetPasswordForm() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = browserClient();

    async function establish() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const code = new URLSearchParams(window.location.search).get('code');

      // Scrub before awaiting anything: the credential should not survive in the
      // address bar even for the duration of a network round trip.
      window.history.replaceState({}, '', window.location.pathname);

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        setStage(sessionError ? 'invalid' : 'ready');
        return;
      }

      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        setStage(exchangeError ? 'invalid' : 'ready');
        return;
      }

      // No token in the URL. Someone already signed in can still set a password
      // here; anyone else needs a fresh link.
      const { data } = await supabase.auth.getUser();
      setStage(data.user ? 'ready' : 'invalid');
    }

    void establish();
  }, []);

  async function submit() {
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setSaving(true);
    const { error: updateError } = await browserClient().auth.updateUser({
      password,
    });
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setStage('saved');
    // A moment on the confirmation, so it is read rather than glimpsed.
    setTimeout(() => router.push('/dashboard'), 1200);
  }

  if (stage === 'checking') {
    return (
      <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <p className="text-sm text-fg-muted">Checking your link…</p>
      </div>
    );
  }

  if (stage === 'invalid') {
    return (
      <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h1 className="text-sm font-semibold text-fg">This link has expired</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Set-password links are single use and time limited. Ask whoever added
          you to generate a new one.
        </p>
        <a
          href="/login"
          className="mt-4 inline-block text-sm text-accent hover:underline"
        >
          Go to sign in
        </a>
      </div>
    );
  }

  if (stage === 'saved') {
    return (
      <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h1 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <CheckCircle2 size={16} className="text-positive" /> Password set
        </h1>
        <p className="mt-2 text-sm text-fg-muted">Taking you in…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
      <h1 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <KeyRound size={16} /> Choose a password
      </h1>
      <p className="mt-1 text-xs text-fg-subtle">
        At least {MIN_LENGTH} characters. This is the only thing standing between
        a stranger and every client&rsquo;s data, so make it a long one.
      </p>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">
            New password
          </span>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 text-sm text-fg"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">
            Again
          </span>
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(event) => setConfirm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            className="w-full rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 text-sm text-fg"
          />
        </label>
      </div>

      {error ? <p className="mt-3 text-xs text-negative">{error}</p> : null}

      <Button className="mt-4 w-full" onClick={submit} disabled={saving}>
        {saving ? 'Saving…' : 'Set password and sign in'}
      </Button>
    </div>
  );
}
