/**
 * Presentation settings for the Client Fulfilment Tracker mirror.
 */

/**
 * Colour CPL by band. SHIPPED OFF, deliberately.
 *
 * The bands are Joshua's: under $15 green, $15 to $19.99 orange, $20 to $24.99
 * red. $25 and above was never confirmed, so it renders neutral rather than
 * being assumed to be worse than red.
 *
 * Off because leads are currently undercounted — Windsor returns zero leads for
 * 30 of 32 ad accounts, a per-account configuration fault rather than an absence
 * of leads, and the view falls back to greatest(windsor, tracker) to compensate.
 * With the denominator too small almost every client paints red, and a table
 * that is red everywhere reads as "everything is broken" rather than as a
 * ranking. Turn this on once the Windsor accounts are fixed and the CPLs are
 * real.
 */
export const CPL_COLOUR_BANDS_ENABLED = false;

export interface CplBand {
  /** Inclusive lower bound, in whole currency units. */
  from: number;
  /** Exclusive upper bound, or null for open-ended. */
  to: number | null;
  tone: 'positive' | 'warning' | 'negative' | 'neutral';
}

export const CPL_BANDS: readonly CplBand[] = [
  { from: 0, to: 15, tone: 'positive' },
  { from: 15, to: 20, tone: 'warning' },
  { from: 20, to: 25, tone: 'negative' },
  // Above $25 was never confirmed. Neutral rather than "worse than red", which
  // would be inventing a band nobody agreed.
  { from: 25, to: null, tone: 'neutral' },
];

export function cplTone(cpl: number | null): CplBand['tone'] | null {
  if (!CPL_COLOUR_BANDS_ENABLED || cpl === null) return null;
  return (
    CPL_BANDS.find((band) => cpl >= band.from && (band.to === null || cpl < band.to))
      ?.tone ?? null
  );
}
