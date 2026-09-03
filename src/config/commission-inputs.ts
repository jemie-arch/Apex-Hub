/**
 * How to read the commission scheme out of the sheet that defines it.
 *
 * ============================ WHERE THIS LIVES ============================
 * "Apex - Call Center Agent Dashboard", tab INPUT VALUES. Three columns:
 * A = Metric, B = Value, C = Meaning. It is a different spreadsheet from the
 * Client Fulfilment Tracker, owned by Joshua, and it is where every rate in the
 * scheme is actually set.
 * ==========================================================================
 *
 * READ BY LABEL, NOT BY CELL
 *
 * The rate was first described as "B12", and B12 is indeed Comms Amount. But
 * addressing cells means a single inserted row silently reassigns every rate:
 * the tier bonus becomes a threshold, the threshold becomes a bonus, and
 * nothing errors. Reading column A and matching the label survives that, and it
 * is the same reason the tracker import matches headers rather than positions.
 *
 * "Commision" is spelled with one s in the sheet. That is not a typo to fix —
 * it is the live label, and searching the file for "commission" returns nothing,
 * which is worth knowing before concluding a rate is missing. Both spellings
 * match here so that correcting it in the sheet does not break this.
 */

/** Every figure the scheme needs, and the label that carries it. */
export const INPUT_LABELS: Readonly<Record<string, string>> = {
  // Commission: paid per booking, at a rate that steps with monthly volume.
  'comms amount': 'unitAmount',
  'commision quota 1': 'quota1Amount',
  'commission quota 1': 'quota1Amount',
  'commision quota 2': 'quota2Amount',
  'commission quota 2': 'quota2Amount',
  'commision quota 1 threshold': 'quota1Threshold',
  'commission quota 1 threshold': 'quota1Threshold',
  'commision quota 2 threshold': 'quota2Threshold',
  'commission quota 2 threshold': 'quota2Threshold',

  // The daily booking bonus, which is a separate payment from commission.
  'tier 1 bonus': 'tier1Bonus',
  'tier 2 bonus': 'tier2Bonus',
  'tier 3 bonus': 'tier3Bonus',
  'tier 1 bonus threshold': 'tier1Threshold',
  'tier 2 bonus threshold': 'tier2Threshold',
  'tier 3 bonus threshold': 'tier3Threshold',

  /*
   * Bookings lost per invalid booking — a COUNT, not an amount.
   *
   * The sheet's own wording: "Numbers of bookings agents lose for each invalid
   * booking". Treating this 2 as dollars would be the easiest and most
   * expensive mistake in the file, so the name says what it is.
   */
  'lost booking penalty': 'bookingsLostPerInvalid',
};

/** Which of those are money, and so are multiplied into cents. */
export const MONEY_FIELDS: readonly string[] = [
  'unitAmount',
  'quota1Amount',
  'quota2Amount',
  'tier1Bonus',
  'tier2Bonus',
  'tier3Bonus',
];

/**
 * The whole tab, not one cell.
 *
 * Columns A to C and every row: the labels are what is being matched, so the
 * range cannot be narrowed to the rows the scheme happens to occupy today.
 */
export const COMMISSION_INPUT_RANGE = 'INPUT VALUES!A:C';

/** Lowercased, collapsed spacing, no trailing punctuation. */
export function normaliseLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
