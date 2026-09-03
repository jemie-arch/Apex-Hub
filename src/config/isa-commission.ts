/**
 * What an ISA earns for booking consultations.
 *
 * ========================= THE SOURCE OF THESE RULES =========================
 * Confirmed by Joshua on 3 September 2026. Worth recording, because Earl
 * designed this scheme and has left the company: there is nobody to ask, and
 * the only written record is an L&S SOP belonging to another agency which Apex
 * may never have adopted. Joshua's answers are now the authority. Do not
 * "correct" anything here from that SOP.
 * =============================================================================
 */

/**
 * The daily bonus, by how many qualifying bookings an ISA made that day.
 *
 * Held in descending order and read top-down, so the first tier a count reaches
 * is the one that pays. Note that 6 and 7 pay the same — that is not a
 * transcription slip, it is what was confirmed: the original scheme jumped 6 to
 * 8 and left 7 undefined, and 7 was settled as $20.
 */
export const BONUS_TIERS: ReadonlyArray<{
  readonly minimum: number;
  readonly amountCents: number;
}> = [
  { minimum: 8, amountCents: 3000 },
  { minimum: 7, amountCents: 2000 },
  { minimum: 6, amountCents: 2000 },
  { minimum: 5, amountCents: 1000 },
];

/** Below this many qualifying bookings in a day, the day pays nothing. */
export const MINIMUM_FOR_ANY_BONUS = 5;

/**
 * The daily bonus for a given number of qualifying bookings.
 *
 * Nine bookings pay the same as eight. There is deliberately no tier above 8 —
 * asked directly, and the answer was "not yet" — so this holds flat rather than
 * extrapolating. Inventing $40 for nine would be paying real money against a
 * rule nobody has agreed, and it would look like a decision somebody made
 * rather than a gap nobody has filled. When a higher tier is agreed, add it to
 * BONUS_TIERS and this needs no change.
 */
export function dailyBonusCents(qualifyingBookings: number): number {
  for (const tier of BONUS_TIERS) {
    if (qualifyingBookings >= tier.minimum) return tier.amountCents;
  }
  return 0;
}

/**
 * Whether a patient who reschedules counts as a second booking.
 *
 * False, and that is a judgement rather than a fact, so it is one line to flip.
 *
 * 45 patients hold 90 rows in the tracker — 7% of the file. 36 of those pairs
 * carry different appointment dates, which is what a reschedule looks like, and
 * a genuine second consultation months later looks identical. The data cannot
 * tell them apart.
 *
 * Counting once is the safer error. Paying an ISA twice because a patient moved
 * their appointment is money out for work not done, and it also inflates the
 * denominator of the 5% test, which makes a bad month look acceptable. Counting
 * once can only under-credit somebody who genuinely booked the same patient
 * twice, which is rarer and visible — the merged rows are reported, not hidden.
 */
export const COUNT_REBOOKINGS_SEPARATELY = false;

/**
 * Commission units lost for each unqualified booking.
 *
 * Confirmed by worked example on 3 September: an ISA who makes 6 bookings in a
 * day, one of which is later disqualified, is left with 4 commission units.
 *
 * Note what that arithmetic says. The deduction comes off the FULL booking
 * count, not off the qualifying ones — 6 - 2 = 4, rather than 5 qualifying
 * minus 2 giving 3. So a disqualified booking is counted and then charged for.
 *
 * Which means a bad booking is worse than no booking at all: five clean
 * bookings are five units, and those same five plus one disqualified are four.
 * That looks deliberate rather than accidental — it is what makes the penalty
 * bite — but it is worth stating out loud, because it is the kind of property
 * somebody notices for the first time in a payslip.
 */
export const UNITS_LOST_PER_UNQUALIFIED = 2;

/**
 * Where one commission unit's value is read from, for the screen to say so.
 *
 * DELIBERATELY NOT A NUMBER HERE. The rate lives in a spreadsheet because that
 * is where it was put, and reading it there means whoever owns the scheme can
 * change it without a deploy and without me. Hardcoding it would fork the
 * figure and the copy in the code would win silently.
 *
 * Not the tracker, either — that was the first guess and it was wrong. "B12 in
 * sheet input values" read as a tab of the Client Fulfilment Tracker, whose
 * INPUT CLIENT INFO tab holds clinics, not rates: B12 there is the client name
 * "Dental Illusions". The real location is set by COMMISSION_INPUTS_SHEET_ID
 * and COMMISSION_UNIT_RANGE, so this is only the human-readable label.
 */
export const COMMISSION_UNIT_SOURCE = 'the commission inputs sheet';

/**
 * The penalty half of the scheme, WHICH IS NOT IMPLEMENTED AND MUST NOT BE.
 *
 * Recorded here so the numbers are not lost, and deliberately not wired into
 * any calculation, because two things are undefined and both change what people
 * are paid:
 *
 *   1. What one "commission unit" is. For an ISA who books 6 in a day and has
 *      one later disqualified, the three readings give 6-2=4 and so nothing,
 *      or $20-$20 and so nothing, or $20-$2 and so $18.
 *
 *   2. Which disqualifications count. This is the larger problem. The
 *      tracker's DQ column runs at 35-50% of all bookings, every month across
 *      eight months — 531 of 1,281 rows. Against a 5% threshold no ISA would
 *      ever earn anything, so the rule must mean something narrower than that
 *      column: presumably bookings that were the ISA's own fault, as against
 *      patients who turned out not to be clinical candidates or could not
 *      afford treatment. Nothing records that distinction today.
 *
 * There is also a sequencing problem worth settling at the same time. The bonus
 * is earned daily, but a disqualification is only known after the consultation,
 * days or weeks later, and the monthly threshold cannot be evaluated until the
 * month closes. So daily figures are provisional by nature: either commission
 * pays monthly in arrears, or paid amounts have to be clawed back.
 */
export const PENDING_PENALTY_RULES = Object.freeze({
  unitsLostPerUnqualified: 2,
  monthlyUnqualifiedLimit: 0.05,
  confirmedBy: 'Joshua',
  confirmedOn: '2026-09-03',
  blockedOn: [
    'what one commission unit is worth',
    'which disqualifications count as the ISA\'s fault',
    'whether daily bonuses are provisional or clawed back',
  ],
} as const);

/**
 * The share of an ISA's monthly bookings that may be disqualified before, under
 * the scheme as described, they forfeit the month.
 *
 * Exported for REPORTING only — to show how far above it everybody currently
 * sits, which is the evidence that the rule needs redefining. Nothing multiplies
 * by it.
 */
export const MONTHLY_UNQUALIFIED_LIMIT = 0.05;
