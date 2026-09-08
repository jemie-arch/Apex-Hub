/**
 * The per-agent booking scoreboard, from the sheet that actually decides pay.
 *
 * WHY THIS SOURCE AND NOT THE CALLS
 *
 * The call centre page ranks people by call activity, and it has always
 * rendered empty: `calls` attributes to a person on 0 of 7,139 rows, because
 * inbound forwards off-platform and GoHighLevel stamps a user on 171 of them —
 * 2.4%. No amount of work here changes that; it is missing upstream.
 *
 * BOOKING SHEET does name people. 318 of its 383 rows carry an agent across
 * four agents, and it is the tab DAILY BONUS TALLY counts, so it is what pay
 * already runs on. That makes it the only honest basis for a scoreboard today.
 *
 * WHAT IT DELIBERATELY SEPARATES
 *
 * Totals from daily bonus. Totals need only an agent, so they work now. The
 * bonus is earned per person per DAY — five bookings pays, four pays nothing —
 * so it needs booked_on, and booked_on is null on all 383 imported rows. That
 * is an open bug in the import, not an empty result, and the two must not look
 * the same on screen: a zero bonus reads as "earned nothing" when the truth is
 * "cannot be calculated yet".
 *
 * Nothing here decides pay. It reports what the sheet's own formula would
 * produce, so the Hub and the dashboard can be reconciled before anybody is
 * paid from the Hub.
 */
import { agentDays, type AgentBooking, type AgentDay, type InvalidReport } from '@/lib/agent-pay';
import { parseScheme, type CommissionScheme } from '@/lib/isa-commission';
import { serviceClient } from '@/lib/supabase/service';

export interface AgentTotals {
  agent: string;
  bookings: number;
  invalid: number;
  /** bookings minus the scheme's penalty per invalid, floored at zero. */
  countable: number;
  /** Cents at the flat unit rate. NOT the bonus, and not what is paid. */
  unitCommissionCents: number;
}

export interface Scoreboard {
  /** Per agent over the whole window. Works without dates. */
  totals: AgentTotals[];
  /** Per agent per day. Empty while booked_on is missing. */
  days: AgentDay[];
  scheme: CommissionScheme | null;
  /** Rows read, and how many of them could not be used, with the reason. */
  audit: {
    bookingRows: number;
    withAgent: number;
    withoutAgent: number;
    withDate: number;
    withoutDate: number;
    invalidReports: number;
    /**
     * Why the daily bonus is absent, or null when it is computable.
     *
     * A sentence rather than a boolean, because it is rendered: whoever opens
     * this page needs to know that the gap is an import fault and not a quiet
     * fortnight.
     */
    dailyBonusBlockedBecause: string | null;
  };
}

/** Cents, at the flat unit rate. Deliberately not the tiered quota rate. */
function unitCents(countable: number, scheme: CommissionScheme | null): number {
  if (!scheme) return 0;
  return countable * scheme.unitAmount;
}

export async function getScoreboard(range: {
  from: string;
  to: string;
}): Promise<Scoreboard> {
  const db = serviceClient();

  const [bookings, invalid, setting] = await Promise.all([
    /*
     * Not filtered by date, on purpose.
     *
     * booked_on is null on every imported row, so a date filter would return
     * nothing and the page would say the call centre made no bookings — which
     * is false and worse than saying the dates are missing. Filtered below
     * only where a date exists, so this corrects itself the moment the import
     * is fixed without another change here.
     */
    db.from('booking_sheet_rows').select('agent, booked_on, disposition'),
    db.from('invalid_booking_reports').select('agent, invalid_on'),
    db.from('app_settings').select('value').eq('key', 'isa_commission_scheme').maybeSingle(),
  ]);

  if (bookings.error) throw bookings.error;
  if (invalid.error) throw invalid.error;
  if (setting.error) throw setting.error;

  const scheme = parseScheme(setting.data?.value ?? null);

  const bookingRows = bookings.data ?? [];
  const invalidRows = invalid.data ?? [];

  const inWindow = (day: string | null): boolean =>
    day === null || (day >= range.from && day <= range.to);

  const dated = bookingRows.filter((row) => row.booked_on !== null);
  const withAgent = bookingRows.filter(
    (row) => (row.agent ?? '').trim() !== '',
  ).length;

  // Totals, over rows that carry an agent. A row with no agent counts toward
  // nobody — in the sheet's own COUNTIFS as much as here — so it is reported
  // as a gap rather than folded into a total.
  const byAgent = new Map<string, AgentTotals>();

  for (const row of bookingRows) {
    const agent = (row.agent ?? '').trim();
    if (agent === '') continue;
    if (!inWindow(row.booked_on)) continue;

    const held =
      byAgent.get(agent) ??
      ({
        agent,
        bookings: 0,
        invalid: 0,
        countable: 0,
        unitCommissionCents: 0,
      } satisfies AgentTotals);

    held.bookings += 1;
    byAgent.set(agent, held);
  }

  for (const row of invalidRows) {
    const agent = (row.agent ?? '').trim();
    if (agent === '') continue;
    if (!inWindow(row.invalid_on)) continue;
    const held = byAgent.get(agent);
    // An invalid report for an agent with no bookings in the window is real
    // and is not invented into a row: it would show a negative countable
    // against somebody who booked nothing here.
    if (!held) continue;
    held.invalid += 1;
  }

  const lost = scheme?.bookingsLostPerInvalid ?? 0;

  for (const held of byAgent.values()) {
    // Floored at zero. The daily formula genuinely goes below the tier and
    // pays nothing, but a negative COUNT on a summary row reads as a bug.
    held.countable = Math.max(held.bookings - lost * held.invalid, 0);
    held.unitCommissionCents = unitCents(held.countable, scheme);
  }

  const totals = [...byAgent.values()].sort((a, b) => b.bookings - a.bookings);

  /*
   * The daily grain, which is where the bonus actually lives. Computed with
   * the same agentDays the pay path uses rather than a second implementation,
   * so the scoreboard cannot disagree with what somebody is paid.
   */
  const days: AgentDay[] =
    scheme && dated.length > 0
      ? agentDays(
          dated
            .filter((row) => inWindow(row.booked_on))
            .map<AgentBooking>((row) => ({
              agent: row.agent,
              bookedOn: row.booked_on,
              disposition: row.disposition,
            })),
          invalidRows.map<InvalidReport>((row) => ({
            agent: row.agent,
            invalidOn: row.invalid_on,
          })),
          scheme,
        )
      : [];

  const dailyBonusBlockedBecause = (() => {
    if (!scheme) {
      return 'The commission scheme has not been read from the sheet yet, so ' +
        'no tier or bonus can be applied. Run commission-inputs.';
    }
    if (bookingRows.length === 0) {
      return 'BOOKING SHEET has not been imported yet, so there is nothing to ' +
        'score. Run booking-sheet.';
    }
    if (dated.length === 0) {
      return `None of the ${bookingRows.length} imported bookings carry a date, ` +
        'so they cannot be grouped into the days the bonus is earned per. The ' +
        'import maps a date column but every value comes through empty — an ' +
        'open bug in booking-sheet, not a quiet period.';
    }
    return null;
  })();

  return {
    totals,
    days,
    scheme,
    audit: {
      bookingRows: bookingRows.length,
      withAgent,
      withoutAgent: bookingRows.length - withAgent,
      withDate: dated.length,
      withoutDate: bookingRows.length - dated.length,
      invalidReports: invalidRows.length,
      dailyBonusBlockedBecause,
    },
  };
}
