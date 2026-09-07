/**
 * Find the header row of a spreadsheet tab instead of assuming it is the first.
 *
 * Written because assuming cost two runs and a day. The Client Fulfilment
 * Tracker's "Appointment Data" tab opens with a merged banner cell reading
 * APPOINTMENT DATA across rows 1-3, and its real headings are on row 4. Reading
 * row 1 produced a single unrecognised header and the sync stopped with
 * "missing required column(s): patient_name, booked_for" while sitting on a
 * sheet that had both.
 *
 * These are sheets people build to look like reports, so a title row, a filter
 * note or a spacer above the table is normal rather than exceptional. Every tab
 * read from the Call Center Agent Dashboard and the tracker should go through
 * here.
 */

/**
 * How far down to look.
 *
 * Eight rows is past every banner seen so far and nowhere near enough to reach
 * into a table of any size, which matters because the scoring below would
 * happily pick a data row if it outscored the headings.
 */
export const HEADER_SEARCH_ROWS = 8;

export interface HeaderRow {
  /** Zero-based index into the rows passed in. */
  index: number;
  /** How many cells in that row were recognised as columns. */
  matches: number;
  /** The sheet's own row number, which is what a person needs to find it. */
  sheetRow: number;
}

/**
 * The candidate row that recognises the most columns.
 *
 * Scoring rather than pattern-matching on purpose: it survives somebody adding
 * a note above the table, and it cannot silently settle on a data row, because
 * a row of patient names and dates matches no column heading at all. A tab with
 * no recognisable header anywhere returns index 0 with zero matches, which
 * leaves the caller to report "missing required columns" and print what it
 * actually saw — the same outcome as before, and the useful one.
 *
 * Ties go to the earliest row. A later row that merely equals the first adds no
 * information, and preferring the first keeps the result stable as the sheet
 * grows.
 */
export function findHeaderRow(
  rows: readonly (readonly string[])[],
  recognises: (cell: string) => boolean,
  searchRows: number = HEADER_SEARCH_ROWS,
): HeaderRow {
  let index = 0;
  let matches = -1;

  rows.slice(0, searchRows).forEach((candidate, candidateIndex) => {
    const score = candidate.filter((cell) => recognises(cell)).length;
    // Strictly greater, so the earliest of equal candidates wins.
    if (score > matches) {
      matches = score;
      index = candidateIndex;
    }
  });

  return { index, matches: Math.max(matches, 0), sheetRow: index + 1 };
}
