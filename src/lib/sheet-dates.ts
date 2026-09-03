/**
 * Reading a date out of a spreadsheet without guessing which month it is in.
 *
 * Its own module because it is tested, and it is tested because getting it
 * wrong moves somebody's bookings between months and so between pay periods,
 * silently and with no error anywhere.
 *
 * ===================== THE TWO TABS DISAGREE WITH EACH OTHER =====================
 * BOOKING SHEET column A is M/D/YYYY. Established rather than assumed: Google's
 * own selection summary gives min 7/10/2026 and max 9/3/2026 across the column.
 * Under D/M/YYYY the max would be 3 September and the min 7 October, so the
 * minimum would have been the September value. It was not. So 7/10/2026 is
 * 10 July, and the tab runs 10 July to 3 September 2026 in row order.
 *
 * APPOINTMENT DATA column B is the OPPOSITE — DD-MM-YYYY, shown by a row
 * reading 01-07-2026 whose own Month column says July.
 *
 * So the convention is a parameter, never a default. Joining the two tabs on a
 * date parsed by one rule would misalign them without failing.
 * =================================================================================
 */

export type DateOrder = 'month-first' | 'day-first';

export interface ParsedSheetDate {
  /** ISO date, or null when it could not be read without guessing. */
  date: string | null;
  /**
   * True when both halves were 12 or under, so the value alone could not
   * confirm the order and the declared convention decided it.
   *
   * Surfaced as a count by the syncs. A file that turns out to use the other
   * convention then shows up as a number to look at, rather than as a month of
   * pay quietly attributed to the wrong period.
   */
  ambiguous: boolean;
}

const iso = (year: string, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function parseSheetDate(
  value: string | undefined | null,
  order: DateOrder,
): ParsedSheetDate {
  const raw = (value ?? '').trim();
  if (raw === '') return { date: null, ambiguous: false };

  // Already unambiguous.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return { date: raw.slice(0, 10), ambiguous: false };

  const parts = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!parts) {
    /*
     * Something else entirely — "21 August 2026", or a string Sheets rendered
     * from a locale we have not seen. Date can read those, and anything it
     * cannot becomes null rather than a guess.
     */
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime())
      ? { date: null, ambiguous: false }
      : { date: fallback.toISOString().slice(0, 10), ambiguous: false };
  }

  const [, first, second, year] = parts;
  const a = Number(first);
  const b = Number(second);

  // A value above 12 cannot be a month, so it settles the order by itself and
  // overrides the declared convention rather than deferring to it.
  if (a > 12 && b <= 12) return { date: iso(year!, b, a), ambiguous: false };
  if (b > 12 && a <= 12) return { date: iso(year!, a, b), ambiguous: false };

  // Both above 12 is not a date at all.
  if (a > 12 && b > 12) return { date: null, ambiguous: false };

  return order === 'month-first'
    ? { date: iso(year!, a, b), ambiguous: true }
    : { date: iso(year!, b, a), ambiguous: true };
}
