/**
 * Reading values out of a spreadsheet cell, shared between the syncs that read
 * the call-centre workbook.
 *
 * Extracted from the call-summaries sync when a second importer — the RAW DATA
 * tab, which is what the pay dashboard counts — needed exactly the same
 * coercion. Both tabs are written by the same Make scenario, 5560467, so a
 * duration or a timestamp arrives in the same shapes in both. Two copies of
 * this logic would eventually disagree about what "3:47" means, and one of the
 * two things it decides is what people are paid.
 *
 * The same reason `sheet-headers.ts` exists.
 */

/**
 * Longest text kept from a cell.
 *
 * Transcripts are the reason there is a limit at all. Truncation is announced
 * inside the value rather than silently applied, so anybody reading a clipped
 * transcript can see that is what happened.
 */
export const MAX_SHEET_TEXT = 20_000;

/** A cell as text, or null when it holds nothing. */
export function text(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_SHEET_TEXT
    ? `${trimmed.slice(0, MAX_SHEET_TEXT)}\n\n[truncated by the Hub at ${MAX_SHEET_TEXT} characters]`
    : trimmed;
}

/**
 * A timestamp, however the sheet spells it.
 *
 * Deliberately permissive, unlike the tracker's date parsing: these columns are
 * written by an automation rather than typed, so they are an ISO instant or a
 * locale string rather than an ambiguous D/M versus M/D. Anything unreadable
 * becomes null rather than a guess, and the row still imports — a call with no
 * timestamp is still worth having, it just cannot appear in a daily count.
 */
export function asInstant(value: string | undefined): string | null {
  const raw = text(value);
  if (raw === null) return null;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  // M/D/YYYY with an optional time, which is what Sheets renders for a US locale.
  const slashed = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
  if (slashed) {
    const [, month, day, year, hour, minute] = slashed;
    const built = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour ?? '0'),
        Number(minute ?? '0'),
      ),
    );
    if (!Number.isNaN(built.getTime())) return built.toISOString();
  }

  return null;
}

/** A date with no time, for columns that carry one. Null when unreadable. */
export function asDate(value: string | undefined): string | null {
  const instant = asInstant(value);
  return instant === null ? null : instant.slice(0, 10);
}

/**
 * A duration in seconds, from whatever the sheet holds.
 *
 * The transcription reports seconds as a number, but the column has also been
 * seen rendered as "3:47". Both are read; anything else is null rather than
 * zero, because a call of unknown length and a call of no length are different
 * and the averages exclude only the second.
 */
export function asSeconds(value: string | undefined): number | null {
  const raw = text(value);
  if (raw === null) return null;

  const clock = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clock) {
    const [, a, b, c] = clock;
    return c === undefined
      ? Number(a) * 60 + Number(b)
      : Number(a) * 3600 + Number(b) * 60 + Number(c);
  }

  const digits = raw.replace(/[^0-9.]/g, '');
  if (digits === '') return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}
