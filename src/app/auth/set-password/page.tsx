import { SetPasswordForm } from '@/components/auth/SetPasswordForm';
import { tenant } from '@/config/tenant.config';

export const metadata = { title: 'Set your password' };

/**
 * Where the link from "Add teammate" lands.
 *
 * Sits under /auth, which middleware already treats as public — a person
 * arriving here has no session yet, so requiring one would make the link
 * useless.
 */
export default function SetPasswordPage() {
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

        <SetPasswordForm />
      </div>
    </main>
  );
}
