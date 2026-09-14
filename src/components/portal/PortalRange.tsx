'use client';

import { usePathname } from 'next/navigation';

import { DateRangePicker } from '@/components/ui/DateRangePicker';

/**
 * The date filter, on every portal page whose content actually has dates.
 *
 * The dashboard has resolved a range since it was built and never rendered a
 * picker, so it filtered by a window nobody could change — the default, for
 * everyone, forever. This is that control, and putting it in the layout means
 * the same one serves every page rather than each growing its own.
 *
 * WHERE IT DOES NOT APPEAR, and why that is not laziness:
 *
 *   Upcoming is forward-looking. Choosing "last 30 days" would empty a page
 *   whose entire job is showing who is coming in, and an empty page with a
 *   filter on it reads as "you have no appointments" rather than "you filtered
 *   them out".
 *
 *   Ads Creative lists the creatives running now. They carry no date to filter
 *   on, so the control would do nothing at all.
 *
 *   Support, Account and Onboarding are conversations and forms, not reports.
 *
 * A control that changes nothing is worse than no control: it teaches people
 * the page is broken. So it is shown exactly where it works.
 */
const DATED_PAGES: readonly string[] = [
  '', // the dashboard
  '/appointments',
  '/agency-appointments',
];

export function PortalRange({ token }: { token: string }) {
  const pathname = usePathname();
  const base = `/portal/${token}`;

  // Everything after the token, so "/portal/abc/appointments" becomes
  // "/appointments" and the dashboard becomes "".
  const page = pathname.startsWith(base) ? pathname.slice(base.length) : null;
  if (page === null) return null;

  const normalised = page.replace(/\/$/, '');
  if (!DATED_PAGES.includes(normalised)) return null;

  return (
    <div className="mb-5 flex justify-end">
      <DateRangePicker />
    </div>
  );
}
