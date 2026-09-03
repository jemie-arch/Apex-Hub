import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { Logo } from '@/components/shell/Logo';

export const metadata = { title: 'Set your password' };

/**
 * Where somebody asks for their own set-password link.
 *
 * Under /auth, which middleware already treats as public — a person who cannot
 * sign in is by definition signed out, and requiring a session here would make
 * the page unreachable by exactly the people who need it.
 */
export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Logo height={56} priority />
        </div>

        <ForgotPasswordForm />
      </div>
    </main>
  );
}
