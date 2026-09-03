import { Coins, TriangleAlert } from 'lucide-react';

import { MONTHLY_UNQUALIFIED_LIMIT } from '@/config/isa-commission';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  type AgentBooking,
  type InvalidReport,
  agentDays,
  agentMonths,
} from '@/lib/agent-pay';
import { parseScheme } from '@/lib/isa-commission';
import { formatCount, formatMoney, formatPercent } from '@/lib/format';
import { requirePermission } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'ISA Commission' };

/**
 * What each ISA earned, from the sheet that actually decides it.
 *
 * Reads BOOKING SHEET and INVALID BOOKINGS, because that is what the live
 * calculation reads: DAILY BONUS TALLY counts BOOKING SHEET by agent and day,
 * subtracts twice the matching invalid reports, and STATS DASHBOARD — the sheet
 * carrying Comms, Bonus and Salary — reads that tally. Nothing in the chain
 * touches the Client Fulfilment Tracker, which is what the first version of this
 * page was built on.
 *
 * THIS PAGE IS FOR RECONCILING, NOT YET FOR PAYING. Its figures should match
 * STATS DASHBOARD agent for agent, and the banner asks for that check rather
 * than for trust. A screen headed "commission" showing plausible money gets paid
 * from whatever its caveats say, so the caveats have to name something a reader
 * can go and verify.
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

  const from = `${chosen}-01`;
  const [year, monthNumber] = chosen.split('-').map(Number);
  const to = new Date(Date.UTC(year!, monthNumber!, 1)).toISOString().slice(0, 10);

  const db = serviceClient();

  const [stored, booked, invalid, nameless] = await Promise.all([
    db
      .from('app_settings')
      .select('value, updated_at')
      .eq('key', 'isa_commission_scheme')
      .maybeSingle(),
    db
      .from('booking_sheet_rows')
      .select('agent, booked_on, disposition')
      .gte('booked_on', from)
      .lt('booked_on', to),
    db
      .from('invalid_booking_reports')
      .select('agent, invalid_on')
      .gte('invalid_on', from)
      .lt('invalid_on', to),
    /*
     * Bookings naming nobody, counted separately because by definition they
     * appear in no agent's row. Roughly half of September's rows are like this
     * and the sheet gives no sign of it, so this page has to.
     */
    db
      .from('booking_sheet_rows')
      .select('*', { count: 'exact', head: true })
      .is('agent', null)
      .gte('booked_on', from)
      .lt('booked_on', to),
  ]);

  if (booked.error) throw booked.error;
  if (invalid.error) throw invalid.error;

  const scheme = parseScheme(stored.data?.value ?? null);
  const schemeReadAt = stored.data?.updated_at ?? null;
  const namelessBookings = nameless.count ?? 0;

  const bookings: AgentBooking[] = (booked.data ?? []).map((row) => ({
    agent: row.agent,
    bookedOn: row.booked_on,
    disposition: row.disposition,
  }));

  const reports: InvalidReport[] = (invalid.data ?? []).map((row) => ({
    agent: row.agent,
    invalidOn: row.invalid_on,
  }));

  // No scheme means no money, and no table either — a row of counts with blank
  // currency columns invites somebody to fill them in by hand.
  const months = scheme ? agentMonths(bookings, reports, scheme) : [];
  const days = scheme ? agentDays(bookings, reports, scheme) : [];

  const payroll = months.reduce((total, row) => total + row.totalCents, 0);

  const monthLabel = new Date(`${chosen}-01T00:00:00Z`).toLocaleDateString(
    undefined,
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  );

  return (
    <>
      <PageHeader
        title="ISA Commission"
        description={`${monthLabel}, by the day each booking was made`}
      />

      {/*
        Two warnings, deliberately not interchangeable. One says "this cannot be
        computed"; the other says "this can be computed but nobody has checked
        it". Collapsing them into a single caveat is how a caveat stops being
        read.
      */}
      {scheme === null ? (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-line bg-negative-subtle px-4 py-3">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-negative" />
          <div className="text-xs text-negative">
            <p className="font-medium">
              No rates have been read, so no money is shown.
            </p>
            <p className="mt-1">
              Run <code>commission-inputs</code> from Settings — it reads INPUT
              VALUES on the Call Center Agent Dashboard. Nothing here falls back
              to a default rate, because a guessed figure on this page would look
              payable.
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-line bg-warning-subtle px-4 py-3">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
          <div className="text-xs text-warning">
            <p className="font-medium">
              Check these against STATS DASHBOARD before paying anybody from them.
            </p>
            <p className="mt-1">
              This reimplements the sheet&rsquo;s own formula, so the two should
              agree agent for agent. Bookings less {scheme.bookingsLostPerInvalid}{' '}
              per invalid one, tiered daily, plus {formatMoney(scheme.unitAmount)}{' '}
              per booking below {scheme.quota1Threshold},{' '}
              {formatMoney(scheme.quota1Amount)} below {scheme.quota2Threshold},
              then {formatMoney(scheme.quota2Amount)}. The{' '}
              {formatPercent(MONTHLY_UNQUALIFIED_LIMIT)} monthly forfeiture is{' '}
              <strong>not</strong> applied: it appears nowhere in the sheet or its
              script, so it is new policy rather than something to reproduce.
            </p>
          </div>
        </div>
      )}

      {namelessBookings > 0 ? (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-negative bg-negative-subtle px-4 py-3">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-negative" />
          <div className="text-xs text-negative">
            <p className="font-medium">
              {formatCount(namelessBookings)} booking(s) this month name no agent.
            </p>
            <p className="mt-1">
              They are attributed to nobody and go unpaid — here and in the sheet,
              where a blank agent matches no COUNTIFS. That is a data-entry gap in
              BOOKING SHEET column B, not something the Hub can repair.
            </p>
          </div>
        </div>
      ) : null}

      {bookings.length === 0 && namelessBookings === 0 ? (
        <EmptyState
          title={`No bookings imported for ${monthLabel}`}
          description={
            'Run booking-sheet from Settings. It needs the Google service ' +
            'account, COMMISSION_INPUTS_SHEET_ID, and the dashboard shared with ' +
            'the service account as a Viewer.'
          }
          icon={<Coins size={22} />}
        />
      ) : months.length === 0 ? null : (
        <>
          <div className="panel mb-6 rounded-lg border border-line bg-surface px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">
              Bonus plus commission, {monthLabel}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">
              {formatMoney(payroll)}
            </p>
            <p className="mt-1 text-xs text-fg-subtle">
              {formatCount(months.length)} agent{months.length === 1 ? '' : 's'} ·{' '}
              {formatCount(days.filter((day) => day.bonusCents > 0).length)} paying
              day(s) · {formatCount(reports.length)} invalid booking(s) reported
            </p>
          </div>

          <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                    <th className="px-4 py-3 font-medium">Agent</th>
                    <th className="px-4 py-3 text-right font-medium">Bookings</th>
                    <th className="px-4 py-3 text-right font-medium">Invalid</th>
                    <th className="px-4 py-3 text-right font-medium">Countable</th>
                    <th className="px-4 py-3 text-right font-medium">Paying days</th>
                    <th className="px-4 py-3 text-right font-medium">Bonus</th>
                    <th className="px-4 py-3 text-right font-medium">Commission</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((row) => (
                    <tr
                      key={`${row.agent} ${row.month}`}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3 font-medium text-fg">{row.agent}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                        {formatCount(row.bookings)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.invalid === 0 ? (
                          <span className="text-fg-subtle">—</span>
                        ) : (
                          <span className="text-warning">
                            {formatCount(row.invalid)}
                          </span>
                        )}
                      </td>
                      {/*
                        Negative shown as negative. Above a 50% invalid rate the
                        deduction outweighs the bookings, and clamping to zero
                        would hide the case the penalty exists for.
                      */}
                      <td
                        className={
                          row.countable < 0
                            ? 'px-4 py-3 text-right font-medium tabular-nums text-negative'
                            : 'px-4 py-3 text-right tabular-nums text-fg'
                        }
                      >
                        {row.countable}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                        {formatCount(row.daysPaying)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                        {formatMoney(row.bonusCents)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted">
                        {formatMoney(row.commissionCents)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-fg">
                        {formatMoney(row.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <h2 className="mb-2 mt-8 text-sm font-semibold text-fg">Day by day</h2>
          <p className="mb-3 max-w-2xl text-xs text-fg-subtle">
            The bonus tier resets daily, so this is the grain it is earned at. An
            invalid booking is deducted before the tier is read, which is why a
            day can hold plenty of bookings and still pay nothing.
          </p>

          <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                    <th className="px-4 py-3 font-medium">Agent</th>
                    <th className="px-4 py-3 font-medium">Booked on</th>
                    <th className="px-4 py-3 text-right font-medium">Bookings</th>
                    <th className="px-4 py-3 text-right font-medium">Invalid</th>
                    <th className="px-4 py-3 text-right font-medium">Countable</th>
                    <th className="px-4 py-3 text-right font-medium">Bonus</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr
                      key={`${day.agent} ${day.day}`}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3 text-fg">{day.agent}</td>
                      <td className="px-4 py-3 tabular-nums text-fg-muted">
                        {day.day}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg">
                        {formatCount(day.bookings)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {day.invalid === 0 ? (
                          <span className="text-fg-subtle">—</span>
                        ) : (
                          <span className="text-warning">
                            {formatCount(day.invalid)}
                          </span>
                        )}
                      </td>
                      <td
                        className={
                          day.countable < 0
                            ? 'px-4 py-3 text-right tabular-nums text-negative'
                            : 'px-4 py-3 text-right tabular-nums text-fg-muted'
                        }
                      >
                        {day.countable}
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
        <h2 className="mb-2 text-sm font-semibold text-fg">Where these come from</h2>
        <ul className="space-y-1 text-xs text-fg-muted">
          <li>
            Bookings and invalid reports: BOOKING SHEET and INVALID BOOKINGS on
            the Call Center Agent Dashboard, via <code>booking-sheet</code>.
          </li>
          <li>
            Rates: INPUT VALUES on the same spreadsheet, via{' '}
            <code>commission-inputs</code>. Change them there, not here.
          </li>
          <li>
            A booking counts against the day it was made, not the appointment
            date.
          </li>
          <li>
            No-shows are not excluded, and cannot be: BOOKING SHEET&rsquo;s
            Disposition column reads &ldquo;Booked&rdquo; on all 362 rows, so
            attendance is not in the pay source at all.
          </li>
        </ul>
        <p className="mt-3 text-xs text-fg-subtle">
          {schemeReadAt === null
            ? 'Rates have never been read from the sheet.'
            : `Rates last read ${schemeReadAt.slice(0, 10)}.`}
        </p>
      </section>
    </>
  );
}
