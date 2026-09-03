import { Coins, TriangleAlert } from 'lucide-react';

import {
  BONUS_TIERS,
  MONTHLY_UNQUALIFIED_LIMIT,
  PENDING_PENALTY_RULES,
} from '@/config/isa-commission';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  type BookingRow,
  dailyTallies,
  monthlySummaries,
  unattributedCount,
} from '@/lib/isa-commission';
import { formatCount, formatMoney, formatPercent } from '@/lib/format';
import { requirePermission } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'ISA Commission' };

/**
 * What each ISA earned for booking consultations.
 *
 * Reads the tracker rather than the CRM, because the tracker is the only place
 * that records who booked an appointment. GoHighLevel can attribute about 2.3%
 * of calls — inbound calls forward to an external line before any GHL user
 * touches them — so tracker_appointments.booked_by is the whole basis of this
 * page.
 *
 * Which means this page is empty until the sheet sync runs, and says so
 * plainly. An earnings page that renders a clean set of zeroes would read as
 * "nobody earned anything this month".
 *
 * The penalty half of the scheme is shown but never applied. See
 * config/isa-commission for why: what a "commission unit" is worth and which
 * disqualifications count are both undecided, and the tracker's DQ column runs
 * at 35-50% of all bookings, so a 5% threshold applied to it would forfeit
 * everybody every month.
 */
export default async function CommissionPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requirePermission('finance');

  const { month } = await searchParams;
  const chosen = /^\d{4}-\d{2}$/.test(month ?? '')
    ? (month as string)
    : new Date().toISOString().slice(0, 7);

  /*
   * Filtered on created_on — the day the booking was made — because that is the
   * day the bonus is earned against. Filtering on booked_for would answer a
   * different question and quietly pay people for a different month's work.
   */
  const from = `${chosen}-01`;
  const [year, monthNumber] = chosen.split('-').map(Number);
  const to = new Date(Date.UTC(year!, monthNumber!, 1)).toISOString().slice(0, 10);

  const booked = await serviceClient()
    .from('tracker_appointments')
    .select('booked_by, created_on, appointment_status, status_if_showed')
    .gte('created_on', from)
    .lt('created_on', to);

  if (booked.error) throw booked.error;

  const rows: BookingRow[] = (booked.data ?? []).map((row) => ({
    bookedBy: row.booked_by,
    createdOn: row.created_on,
    appointmentStatus: row.appointment_status,
    statusIfShowed: row.status_if_showed,
  }));

  const summaries = monthlySummaries(rows);
  const days = dailyTallies(rows);
  const unattributed = unattributedCount(rows);
  const payroll = summaries.reduce((total, row) => total + row.bonusCents, 0);

  const monthLabel = new Date(`${chosen}-01T00:00:00Z`).toLocaleDateString(
    undefined,
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  );

  return (
    <>
      <PageHeader
        title="ISA Commission"
        description={`Booking bonus for ${monthLabel}, by the day each booking was made`}
      />

      {/*
        Stated up front rather than in a footnote. Somebody reading a payroll
        figure needs to know it is missing its deductions before they act on it.
      */}
      <div className="mb-6 flex items-start gap-3 rounded-lg border border-line bg-warning-subtle px-4 py-3">
        <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
        <div className="text-xs text-warning">
          <p className="font-medium">
            These are gross figures. The unqualified-booking penalty is not
            applied.
          </p>
          <p className="mt-1">
            {PENDING_PENALTY_RULES.unitsLostPerUnqualified} commission units are
            lost per unqualified booking, and above{' '}
            {formatPercent(MONTHLY_UNQUALIFIED_LIMIT)} of a month&rsquo;s
            bookings the month is forfeit. Neither is calculated here, because{' '}
            {PENDING_PENALTY_RULES.blockedOn.join('; ')} — all still open. Do not
            pay from this page until they are settled.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={`No bookings recorded in ${monthLabel}`}
          description={
            'Nothing was booked in this month, or the tracker has not been ' +
            'imported for it. The tracker was last read on 22 August.'
          }
          icon={<Coins size={22} />}
        />
      ) : summaries.length === 0 ? (
        /*
         * Rows exist but none carry a name. This is the state the page is in
         * today — booked_by is null on every one of the 1,281 imported rows —
         * and it is the single most important thing the page can say.
         */
        <EmptyState
          title="No booking is attributed to an ISA yet"
          description={
            `All ${formatCount(rows.length)} booking(s) in ${monthLabel} have an ` +
            'empty "booked by" column, so there is nobody to pay. This fills in ' +
            'when the fulfilment-tracker sync runs against the live sheet — set ' +
            'the Google service account credentials, share the tracker with it, ' +
            'and run it once from Settings.'
          }
          icon={<Coins size={22} />}
        />
      ) : (
        <>
          <div className="panel mb-6 rounded-lg border border-line bg-surface px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">
              Gross booking bonus, {monthLabel}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">
              {formatMoney(payroll)}
            </p>
            <p className="mt-1 text-xs text-fg-subtle">
              across {formatCount(summaries.length)} ISA
              {summaries.length === 1 ? '' : 's'} and{' '}
              {formatCount(days.filter((day) => day.bonusCents > 0).length)} paying
              day(s)
              {unattributed > 0
                ? ` · ${formatCount(unattributed)} booking(s) name nobody and are excluded`
                : ''}
            </p>
          </div>

          <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                    <th className="px-4 py-3 font-medium">ISA</th>
                    <th className="px-4 py-3 text-right font-medium">Bookings</th>
                    <th className="px-4 py-3 text-right font-medium">Qualifying</th>
                    <th className="px-4 py-3 text-right font-medium">Pending</th>
                    <th className="px-4 py-3 text-right font-medium">No show</th>
                    <th className="px-4 py-3 text-right font-medium">Unqualified</th>
                    <th className="px-4 py-3 text-right font-medium">Paying days</th>
                    <th className="px-4 py-3 text-right font-medium">Gross bonus</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((row) => (
                    <tr
                      key={`${row.isa} ${row.month}`}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3 font-medium text-fg">{row.isa}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                        {formatCount(row.total)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">
                        {formatCount(row.qualifying)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-subtle">
                        {formatCount(row.pending)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                        {formatCount(row.noShow)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="text-fg-muted">
                          {formatCount(row.unqualified)}
                        </span>
                        {row.exceedsUnqualifiedLimit ? (
                          <span className="ml-2 align-middle">
                            <StatusPill
                              value={formatPercent(row.unqualifiedRate, 1)}
                              tone="warning"
                            />
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                        {formatCount(row.daysPaying)} of {formatCount(row.daysBooked)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-fg">
                        {formatMoney(row.bonusCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <h2 className="mb-2 mt-8 text-sm font-semibold text-fg">
            Day by day
          </h2>
          <p className="mb-3 max-w-2xl text-xs text-fg-subtle">
            The tier resets every day, so this is the grain the bonus is actually
            earned at — eleven qualifying bookings are {formatMoney(3000)} in one
            day and nothing at all spread over three.
          </p>

          <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                    <th className="px-4 py-3 font-medium">ISA</th>
                    <th className="px-4 py-3 font-medium">Booked on</th>
                    <th className="px-4 py-3 text-right font-medium">Qualifying</th>
                    <th className="px-4 py-3 text-right font-medium">Of total</th>
                    <th className="px-4 py-3 text-right font-medium">Bonus</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr
                      key={`${day.isa} ${day.day}`}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3 text-fg">{day.isa}</td>
                      <td className="px-4 py-3 tabular-nums text-fg-muted">
                        {day.day}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">
                        {formatCount(day.qualifying)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-subtle">
                        {formatCount(day.total)}
                      </td>
                      <td
                        className={
                          day.bonusCents > 0
                            ? 'px-4 py-3 text-right font-medium tabular-nums text-fg'
                            : 'px-4 py-3 text-right tabular-nums text-fg-subtle'
                        }
                      >
                        {formatMoney(day.bonusCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <section className="mt-8 max-w-2xl">
        <h2 className="mb-2 text-sm font-semibold text-fg">The rules</h2>
        <ul className="space-y-1 text-xs text-fg-muted">
          {[...BONUS_TIERS].reverse().map((tier) => (
            <li key={tier.minimum}>
              {tier.minimum} qualifying bookings in a day —{' '}
              {formatMoney(tier.amountCents)}
            </li>
          ))}
          <li>
            Fewer than {BONUS_TIERS[BONUS_TIERS.length - 1]?.minimum} pays nothing.
            There is no tier above {BONUS_TIERS[0]?.minimum} yet, so more pays the
            same.
          </li>
          <li>
            A booking counts against the day the ISA booked it, not the day of
            the appointment.
          </li>
          <li>No-shows and unqualified bookings do not pay.</li>
        </ul>
        <p className="mt-3 text-xs text-fg-subtle">
          Confirmed by {PENDING_PENALTY_RULES.confirmedBy} on{' '}
          {PENDING_PENALTY_RULES.confirmedOn}. Earl designed this scheme and has
          left, so there is nobody to check it against — these answers are the
          record.
        </p>
      </section>
    </>
  );
}
