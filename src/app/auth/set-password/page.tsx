import { SetPasswordForm } from '@/components/auth/SetPasswordForm';
import { Logo } from '@/components/shell/Logo';
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
        <div className="mb-8">
          <Logo width={170} height={44} priority />
          <p className="mt-2 text-xs text-fg-subtle">{tenant.company.tagline}</p>
        </div>

        <SetPasswordForm />
      </div>
    </main>
  );
}
