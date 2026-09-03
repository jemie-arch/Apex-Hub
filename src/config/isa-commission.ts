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
