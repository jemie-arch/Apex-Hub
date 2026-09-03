/**
 * ============================ NOT THE PAY PATH ============================
 * classify, collapseDuplicates, dailyTallies, monthlySummaries and
 * unattributedCount work from the Client Fulfilment Tracker, and NOTHING is
 * paid from them. The live calculation reads BOOKING SHEET — see lib/agent-pay,
 * which is what the commission page uses.
 *
 * They are kept rather than deleted for one specific reason. BOOKING SHEET's
 * Disposition column is a constant, so attendance is absent from the pay
 * source; if the daily bonus is ever to exclude no-shows, the outcome has to be
 * joined from tracker_appointments, and this is that half already written and
 * checked. Delete it if that decision goes the other way, rather than leaving
 * two plausible answers in the codebase.
 *
 * The scheme helpers below it — CommissionScheme, parseScheme,
 * ratePerBookingCents, commissionCentsFor, dailyBonusCentsFrom — ARE on the pay
 * path and are used by lib/agent-pay.
 * ==========================================================================
 *
 * Working out ISA commission from tracker bookings.
 *
 * Pure functions over plain rows: no database, no clock, no environment. The
 * whole point is that npm run check:commission can exercise the rules against
 * cases nobody has to wait for real data to produce — which matters here more
 * than usual, because this decides what people are paid and the tracker's
 * booked_by column is empty until the sheet sync runs.
 *
 * TWO DATES, AND THE RIGHT ONE
 *
 * A booking counts against the day the ISA booked it — created_on — and not the
 * day the appointment is scheduled for. That was an explicit decision by Joshua
 * on 3 September rather than a default, and it matters: an ISA who books fifteen
 * consultations on a Monday for the following fortnight earns very differently
 * under each reading.
 */
import {
  COUNT_REBOOKINGS_SEPARATELY,
  MONTHLY_UNQUALIFIED_LIMIT,
  UNITS_LOST_PER_UNQUALIFIED,
  dailyBonusCents,
} from '@/config/isa-commission';

/** One tracker row, only the fields the calculation reads. */
export interface BookingRow {
  bookedBy: string | null;
  /** The day the ISA made the booking. The day that pays. */
  createdOn: string | null;
  appointmentStatus: string | null;
  statusIfShowed: string | null;
  /** Who the appointment is for. Used to recognise the same booking twice. */
  patientName?: string | null;
  /** Which practice. A common name at two practices is two patients. */
  locationName?: string | null;
  /** The appointment date, for telling a duplicate from a reschedule. */
  bookedFor?: string | null;
}

/**
 * Collapse rows that describe the same booking.
 *
 * Two shapes occur, and they need different treatment:
 *
 * A DUPLICATE is the same patient, same practice, same appointment date, twice.
 * Nine patients look like this. It is a spreadsheet artefact and always merges.
 *
 * A RESCHEDULE is the same patient and practice with a different appointment
 * date. Thirty-six look like this, and they are indistinguishable from a genuine
 * second consultation booked months later. Merged by default — see
 * COUNT_REBOOKINGS_SEPARATELY for why counting once is the safer error.
 *
 * The surviving row keeps the EARLIEST createdOn, because that is the day the
 * ISA did the work, and the outcome of the LATEST appointment, because that is
 * what actually happened to the patient. Taking the first outcome would credit
 * an ISA for a consultation that was later moved and then disqualified.
 *
 * Rows with no patient name are never merged: an unnamed row cannot be shown to
 * be the same booking as another, and merging on absence would silently delete
 * work.
 */
export function collapseDuplicates(rows: BookingRow[]): {
  rows: BookingRow[];
  merged: number;
} {
  const byBooking = new Map<string, BookingRow>();
  const passthrough: BookingRow[] = [];
  let merged = 0;

  for (const row of rows) {
    const patient = normalise(row.patientName ?? null);
    if (patient === '') {
      passthrough.push(row);
      continue;
    }

    const key = COUNT_REBOOKINGS_SEPARATELY
      ? `${patient}|${normalise(row.locationName ?? null)}|${row.bookedFor ?? ''}`
      : `${patient}|${normalise(row.locationName ?? null)}`;

    const held = byBooking.get(key);
    if (!held) {
      byBooking.set(key, row);
      continue;
    }

    merged += 1;

    /*
     * Chosen by content, not by the order the rows arrived in.
     *
     * Comparing against whichever row happened to be seen first made the
     * credited ISA depend on the sheet's row order while the credited DAY did
     * not, so the same two rows in the other order paid a different person. A
     * sort order is not a fact about who did the work.
     */
    const origin =
      (held.createdOn ?? '9999-12-31') <= (row.createdOn ?? '9999-12-31')
        ? held
        : row;

    const current =
      (row.bookedFor ?? '') >= (held.bookedFor ?? '') ? row : held;

    byBooking.set(key, {
      ...current,
      // Both come from the original booking: a reschedule is not new work, so
      // it neither moves the day nor transfers the credit.
      createdOn: origin.createdOn,
      bookedBy: origin.bookedBy,
    });
  }

  return { rows: [...byBooking.values(), ...passthrough], merged };
}

/**
 * What a booking is worth to its ISA.
 *
 * 'pending' exists because it is the honest answer for most of a month. A
 * consultation that has not happened yet, or that happened and whose outcome
 * nobody has written down, is not a qualifying booking and is not a failure
 * either — and collapsing it into either one would make a running total look
 * settled when it is not.
 */
export type BookingState =
  | 'qualifying'
  | 'no_show'
  | 'unqualified'
  | 'pending'
  | 'unattributed';

/**
 * Loose comparison for values a person typed into a spreadsheet.
 *
 * The tracker is worked in daily by the call centre, so "No Show", "no-show"
 * and "No  Show" all occur. Comparing raw strings here would silently drop
 * somebody's booking, and a booking that pays nothing because of a hyphen is
 * indistinguishable from one that pays nothing because it was a no-show.
 */
function normalise(value: string | null): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isDisqualified(statusIfShowed: string | null): boolean {
  const key = normalise(statusIfShowed);
  return key === 'dq' || key.startsWith('disqualif');
}

/**
 * Classify one booking.
 *
 * Disqualification is tested before attendance, so a row that is both DQ and a
 * no-show counts as unqualified. Neither pays, so the money is the same either
 * way — but the two are not interchangeable once the penalty rule is settled,
 * because that rule counts disqualifications and the denominator has to be
 * consistent with it.
 */
export function classify(row: BookingRow): BookingState {
  // No name and no date means no ISA and no day, so there is nothing to pay
  // against. Counted rather than discarded: while booked_by is unpopulated this
  // is every row, and a calculation that quietly returned zero would look like
  // "nobody earned anything" instead of "nothing is attributed yet".
  if (!row.bookedBy?.trim() || !row.createdOn) return 'unattributed';

  if (isDisqualified(row.statusIfShowed)) return 'unqualified';

  const status = normalise(row.appointmentStatus);
  if (status === 'noshow') return 'no_show';

  // Showed, and an outcome recorded that was not a disqualification — Closed or
  // Follow up. Both are qualifying: the rule withholds pay for no-shows and
  // disqualifications, and a follow-up is neither.
  if (status === 'showed' && normalise(row.statusIfShowed) !== '') {
    return 'qualifying';
  }

  return 'pending';
}

export interface DailyTally {
  isa: string;
  /** ISO date, the day the bookings were made. */
  day: string;
  qualifying: number;
  bonusCents: number;
  noShow: number;
  unqualified: number;
  pending: number;
  total: number;
  /**
   * Bookings made, less two for every disqualified one.
   *
   * The deduction comes off the full booking count rather than the qualifying
   * subset — six bookings with one disqualified is four units, not three —
   * which is the arithmetic confirmed on 3 September.
   *
   * Allowed to go negative, and deliberately not clamped at zero. An ISA whose
   * disqualification rate passes half owes more units than they earned, and a
   * floor would hide precisely the case the penalty exists to surface. Whether
   * a negative day carries against the rest of the month is not decided, so
   * nothing here spends it.
   *
   * Not converted to money anywhere. One unit is worth whatever cell B12 of the
   * tracker's input values says, and that sheet is unreadable until the service
   * account exists.
   */
  commissionUnits: number;
}

/**
 * Per ISA, per day — which is the grain the bonus is actually earned at.
 *
 * The tier resets daily, so this cannot be derived from a monthly total: eleven
 * qualifying bookings are $30 in one day and nothing at all spread over three.
 */
export function dailyTallies(rows: BookingRow[]): DailyTally[] {
  const byKey = new Map<string, DailyTally>();

  for (const row of rows) {
    const state = classify(row);
    if (state === 'unattributed') continue;

    const isa = row.bookedBy!.trim();
    const day = row.createdOn!.slice(0, 10);
    const key = `${isa} ${day}`;

    const tally =
      byKey.get(key) ??
      {
        isa,
        day,
        qualifying: 0,
        bonusCents: 0,
        noShow: 0,
        unqualified: 0,
        pending: 0,
        total: 0,
        commissionUnits: 0,
      };

    tally.total += 1;
    if (state === 'qualifying') tally.qualifying += 1;
    if (state === 'no_show') tally.noShow += 1;
    if (state === 'unqualified') tally.unqualified += 1;
    if (state === 'pending') tally.pending += 1;

    byKey.set(key, tally);
  }

  for (const tally of byKey.values()) {
    tally.bonusCents = dailyBonusCents(tally.qualifying);
    tally.commissionUnits =
      tally.total - UNITS_LOST_PER_UNQUALIFIED * tally.unqualified;
  }

  return [...byKey.values()].sort(
    (a, b) => a.isa.localeCompare(b.isa) || a.day.localeCompare(b.day),
  );
}

export interface MonthlySummary {
  isa: string;
  /** YYYY-MM. */
  month: string;
  /** Days on which anything was booked at all. */
  daysBooked: number;
  /** Days that reached a tier. */
  daysPaying: number;
  qualifying: number;
  noShow: number;
  unqualified: number;
  pending: number;
  total: number;
  /** The sum of the daily tiers. The penalty is NOT applied. */
  bonusCents: number;
  /**
   * Bookings for the month, less two per disqualified one.
   *
   * Reported as a count, never as money — one unit is worth cell B12 of the
   * tracker, which cannot be read yet. Given the disqualification rate runs at
   * 35-50%, expect this to be a small fraction of bookings and, above a 50%
   * rate, negative.
   */
  commissionUnits: number;
  /** Disqualified as a share of all bookings, 0–1. Reporting only. */
  unqualifiedRate: number;
  /**
   * Whether that share is above the 5% the scheme describes.
   *
   * Informational, and currently true for essentially everybody: the DQ column
   * runs at 35-50% of bookings. That is the evidence the threshold means
   * something narrower than the column, not a statement that anybody has
   * forfeited anything. Nothing acts on this.
   */
  exceedsUnqualifiedLimit: boolean;
}

/**
 * Roll the daily tallies up to the month.
 *
 * Sums the daily bonuses rather than re-tiering the monthly total, because the
 * tier is a daily rule. Deliberately does not apply the penalty or the
 * forfeiture: what a "commission unit" is worth, and which disqualifications
 * count, are both undecided, and guessing either would produce a number that
 * looks authoritative and pays somebody the wrong amount.
 */
export function monthlySummaries(rows: BookingRow[]): MonthlySummary[] {
  const byKey = new Map<string, MonthlySummary>();
  const payingDays = new Map<string, number>();

  for (const tally of dailyTallies(rows)) {
    const month = tally.day.slice(0, 7);
    const key = `${tally.isa} ${month}`;

    const summary =
      byKey.get(key) ??
      {
        isa: tally.isa,
        month,
        daysBooked: 0,
        daysPaying: 0,
        qualifying: 0,
        noShow: 0,
        unqualified: 0,
        pending: 0,
        total: 0,
        bonusCents: 0,
        commissionUnits: 0,
        unqualifiedRate: 0,
        exceedsUnqualifiedLimit: false,
      };

    summary.daysBooked += 1;
    summary.qualifying += tally.qualifying;
    summary.noShow += tally.noShow;
    summary.unqualified += tally.unqualified;
    summary.pending += tally.pending;
    summary.total += tally.total;
    summary.bonusCents += tally.bonusCents;
    summary.commissionUnits += tally.commissionUnits;
    if (tally.bonusCents > 0) {
      payingDays.set(key, (payingDays.get(key) ?? 0) + 1);
    }

    byKey.set(key, summary);
  }

  for (const [key, summary] of byKey) {
    summary.daysPaying = payingDays.get(key) ?? 0;
    summary.unqualifiedRate =
      summary.total === 0 ? 0 : summary.unqualified / summary.total;
    summary.exceedsUnqualifiedLimit =
      summary.unqualifiedRate > MONTHLY_UNQUALIFIED_LIMIT;
  }

  return [...byKey.values()].sort(
    (a, b) => b.month.localeCompare(a.month) || a.isa.localeCompare(b.isa),
  );
}

/** How many rows could not be attributed to an ISA and a day. */
export function unattributedCount(rows: BookingRow[]): number {
  return rows.filter((row) => classify(row) === 'unattributed').length;
}

/**
 * The scheme as the sheet defines it, in cents and booking counts.
 *
 * Read by the commission-inputs sync from INPUT VALUES on the Call Center Agent
 * Dashboard. Optional everywhere: the config values in config/isa-commission
 * stand in until a run has happened, and the page says which it is using.
 */
export interface CommissionScheme {
  /** Cents per booking below quota1Threshold bookings. */
  unitAmount: number;
  /** Cents per booking below quota2Threshold. */
  quota1Amount: number;
  /** Cents per booking at or above quota2Threshold. */
  quota2Amount: number;
  quota1Threshold: number;
  quota2Threshold: number;
  tier1Bonus: number;
  tier2Bonus: number;
  tier3Bonus: number;
  tier1Threshold: number;
  tier2Threshold: number;
  tier3Threshold: number;
  /** Bookings lost per invalid booking. A COUNT, not an amount. */
  bookingsLostPerInvalid: number;
}

const SCHEME_FIELDS: readonly (keyof CommissionScheme)[] = [
  'unitAmount',
  'quota1Amount',
  'quota2Amount',
  'quota1Threshold',
  'quota2Threshold',
  'tier1Bonus',
  'tier2Bonus',
  'tier3Bonus',
  'tier1Threshold',
  'tier2Threshold',
  'tier3Threshold',
  'bookingsLostPerInvalid',
];

/**
 * A stored scheme, or null if it is not a complete one.
 *
 * All or nothing on purpose. A half-populated scheme would pay from a mixture
 * of the sheet and the fallback, and no figure on screen would say which — so a
 * missing field discards the lot and the page falls back visibly.
 */
export function parseScheme(value: unknown): CommissionScheme | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  const scheme = {} as CommissionScheme;
  for (const field of SCHEME_FIELDS) {
    const raw = record[field];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    scheme[field] = raw;
  }
  return scheme;
}

/**
 * Cents per booking, at this volume.
 *
 * The rate steps with how many bookings the ISA has: $8 below 96, $10 below
 * 128, $12 above. Reproduces STATS DASHBOARD!O2, which nests the same three
 * cases in the same order.
 */
export function ratePerBookingCents(
  bookings: number,
  scheme: CommissionScheme,
): number {
  if (bookings < scheme.quota1Threshold) return scheme.unitAmount;
  if (bookings < scheme.quota2Threshold) return scheme.quota1Amount;
  return scheme.quota2Amount;
}

/**
 * Commission for a month's units.
 *
 * ONE ASSUMPTION, STATED: the volume tier is chosen by units — bookings after
 * the invalid-booking deduction — rather than by gross bookings. The sheet's
 * formula multiplies and tiers on the same figure, so it cannot distinguish the
 * two, and they differ only for somebody sitting within two bookings of 96 or
 * 128. Tiering on units is the consistent reading: it pays the rate the ISA's
 * countable work earned. If gross should decide it, this is the one line to
 * change.
 *
 * Negative units earn nothing rather than owing money. Whether a negative
 * carries against anything is undecided, and inventing a debt is worse than
 * paying zero.
 */
export function commissionCentsFor(
  units: number,
  scheme: CommissionScheme,
): number {
  if (units <= 0) return 0;
  return units * ratePerBookingCents(units, scheme);
}

/**
 * The daily bonus under a scheme read from the sheet.
 *
 * Uses >= at every tier, matching STATS DASHBOARD!P2. TODAY'S DATA!M3 uses = on
 * tiers 1 and 2, so seven bookings there fall through every branch and pay
 * nothing — which contradicts what was confirmed for seven, so this follows the
 * dashboard and treats the other as the bug it appears to be.
 */
export function dailyBonusCentsFrom(
  qualifyingBookings: number,
  scheme: CommissionScheme,
): number {
  if (qualifyingBookings >= scheme.tier3Threshold) return scheme.tier3Bonus;
  if (qualifyingBookings >= scheme.tier2Threshold) return scheme.tier2Bonus;
  if (qualifyingBookings >= scheme.tier1Threshold) return scheme.tier1Bonus;
  return 0;
}
