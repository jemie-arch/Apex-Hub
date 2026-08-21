import { redirect } from 'next/navigation';

/**
 * There is no landing page. Middleware has already decided who this person is
 * by the time they get here, and staff are redirected to their own page from
 * /dashboard rather than being given a different entry point.
 */
export default function RootPage() {
  redirect('/dashboard');
}
