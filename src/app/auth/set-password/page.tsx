import { SetPasswordForm } from '@/components/auth/SetPasswordForm';
import { Logo } from '@/components/shell/Logo';

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
          <Logo height={56} priority />
        </div>

        <SetPasswordForm />
      </div>
    </main>
  );
}
