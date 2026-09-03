/**
 * What each ISA is paid, computed from the sheet that actually decides it.
 *
 * Separate from lib/isa-commission, which works from the Client Fulfilment
 * Tracker. That module was built on the wrong source: reading the live formulas
 * showed nothing in the pay chain touches the tracker. DAILY BONUS TALLY counts
 * BOOKING SHEET by agent and day, subtracts twice the matching INVALID BOOKINGS
 * rows, and STATS DASHBOARD — the sheet carrying Comms, Bonus and Salary —
 * reads that tally.
 *
 * This is deliberately a REIMPLEMENTATION of that formula rather than an
 * improvement on it. Its job is to be checkable against what agents are already
 * paid: a figure here that disagrees with the dashboard is a bug in one of the
 * two, and that is worth knowing before anybody is paid from the Hub.
 */
import {
  type CommissionScheme,
  commissionCentsFor,
  dailyBonusCentsFrom,
} from '@/lib/isa-commission';

/** One BOOKING SHEET row, only what the calculation reads. */
export interface AgentBooking {
  agent: string | null;
  /** The day the booking was made. Column A, and the only date on the tab. */
  bookedOn: string | null;
  disposition?: string | null;
}

/** One invalid-booking report, by agent and the day the booking was made. */
export interface InvalidReport {
  agent: string | null;
  invalidOn: string | null;
}

export interface AgentDay {
  agent: string;
  day: string;
  bookings: number;
  invalid: number;
  /** bookings minus two per invalid. What the tier is read against. */
  countable: number;
  bonusCents: number;
}

export interface PayOptions {
  /**
   * Count only bookings that pass `qualifies`.
   *
   * Off by default, because the live formula does not filter on outcome at all:
   * every row for that agent and day counts, whatever the disposition says. So
   * the scheme as implemented pays for making a booking and handles bad ones
   * through the invalid-booking form — which contradicts "no-shows and
   * disqualifications do not pay" as it was described to me.
   *
   * Both readings are defensible and they pay differently, so this exists to
   * compute both and show the gap rather than to pick a side. Nobody's wage
   * should turn on which one I found more plausible.
   *
   * NOTHING CAN DRIVE IT FROM BOOKING SHEET TODAY. Its Disposition column is a
   * constant — 362 of 362 rows read "Booked" — so attendance is not in the pay
   * source at all. Filtering therefore needs an outcome joined from elsewhere:
   * tracker_appointments.appointment_status, or GoHighLevel directly. Until
   * then the live behaviour is the only computable one, and that is a fact
   * about the data rather than a decision anybody made.
   */
  qualifyingOnly?: boolean;
  qualifies?: (row: AgentBooking) => boolean;
}

/**
 * Per agent, per day — the grain the bonus is earned at.
 *
 * Mirrors:
 *   COUNTIFS('BOOKING SHEET'!B:B, agent, 'BOOKING SHEET'!A:A, ">="&day,
 *            'BOOKING SHEET'!A:A, "<"&day+1)
 *   - 2*COUNTIFS('INVALID BOOKINGS'!B:B, agent, 'INVALID BOOKINGS'!A:A, ...)
 *
 * One property of that formula decides real money and is not obvious: the
 * penalty is subtracted BEFORE the tier is read, not deducted from the bonus
 * afterwards. Six bookings with one invalid is four countable, which is below
 * five, so the day pays nothing at all rather than a reduced amount.
 */
export function agentDays(
  bookings: AgentBooking[],
  invalid: InvalidReport[],
  scheme: CommissionScheme,
  options: PayOptions = {},
): AgentDay[] {
  const byKey = new Map<string, AgentDay>();

  const reach = (agent: string, day: string): AgentDay => {
    const key = `${agent} ${day}`;
    const held = byKey.get(key);
    if (held) return held;
    const fresh: AgentDay = {
      agent,
      day,
      bookings: 0,
      invalid: 0,
      countable: 0,
      bonusCents: 0,
    };
    byKey.set(key, fresh);
    return fresh;
  };

  for (const row of bookings) {
    const agent = row.agent?.trim();
    const day = row.bookedOn?.slice(0, 10);

    /*
     * No agent or no day means this contributes to nobody — exactly as it
     * contributes to no COUNTIFS in the sheet. Skipped here and counted by the
     * sync instead, because roughly half of September's rows have a blank agent
     * and the silence is the problem, not the intent.
     */
    if (!agent || !day) continue;

    if (options.qualifyingOnly && options.qualifies && !options.qualifies(row)) {
      continue;
    }

    reach(agent, day).bookings += 1;
  }

  /*
   * A report can reach an agent-day with no bookings, and that is kept rather
   * than dropped. It is how a form entry whose agent name matches nothing on
   * BOOKING SHEET becomes visible as a negative day instead of silently failing
   * to apply — the form field is free text, so a typo there costs nobody
   * anything and nothing says so.
   */
  for (const report of invalid) {
    const agent = report.agent?.trim();
    const day = report.invalidOn?.slice(0, 10);
    if (!agent || !day) continue;
    reach(agent, day).invalid += 1;
  }

  for (const day of byKey.values()) {
    day.countable = day.bookings - scheme.bookingsLostPerInvalid * day.invalid;
    day.bonusCents = dailyBonusCentsFrom(day.countable, scheme);
  }

  return [...byKey.values()].sort(
    (a, b) => a.agent.localeCompare(b.agent) || a.day.localeCompare(b.day),
  );
}

export interface AgentMonth {
  agent: string;
  month: string;
  bookings: number;
  invalid: number;
  countable: number;
  daysPaying: number;
  bonusCents: number;
  commissionCents: number;
  /** Bonus plus commission — the figure a payslip would carry. */
  totalCents: number;
}

/**
 * A month per agent: the daily bonus summed, plus commission on the month.
 *
 * The two are computed at different grains because that is how the scheme
 * works. The bonus resets daily, so it is summed across days. Commission is a
 * per-booking rate chosen by the month's volume, so it applies once to the
 * month's countable total — which is what STATS DASHBOARD!O2 does.
 */
export function agentMonths(
  bookings: AgentBooking[],
  invalid: InvalidReport[],
  scheme: CommissionScheme,
  options: PayOptions = {},
): AgentMonth[] {
  const byKey = new Map<string, AgentMonth>();

  for (const day of agentDays(bookings, invalid, scheme, options)) {
    const month = day.day.slice(0, 7);
    const key = `${day.agent} ${month}`;

    const held =
      byKey.get(key) ??
      {
        agent: day.agent,
        month,
        bookings: 0,
        invalid: 0,
        countable: 0,
        daysPaying: 0,
        bonusCents: 0,
        commissionCents: 0,
        totalCents: 0,
      };

    held.bookings += day.bookings;
    held.invalid += day.invalid;
    held.countable += day.countable;
    held.bonusCents += day.bonusCents;
    if (day.bonusCents > 0) held.daysPaying += 1;

    byKey.set(key, held);
  }

  for (const month of byKey.values()) {
    month.commissionCents = commissionCentsFor(month.countable, scheme);
    month.totalCents = month.bonusCents + month.commissionCents;
  }

  return [...byKey.values()].sort(
    (a, b) => b.month.localeCompare(a.month) || a.agent.localeCompare(b.agent),
  );
}
