import { Suspense } from 'react';

import { LoginForm } from '@/components/auth/LoginForm';
import { tenant } from '@/config/tenant.config';

export const metadata = { title: 'Sign in' };

/**
 * A server component wrapping the form in Suspense. The form reads
 * searchParams (to honour ?next=), which bails out to the client — without a
 * boundary here that fails the production build rather than just this page.
 */
export default function LoginPage() {
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

        <Suspense
          fallback={
            <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
              <p className="text-sm text-fg-muted">Loading…</p>
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
