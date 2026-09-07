/**
 * The Client Fulfilment Tracker, on a schedule instead of by hand.
 *
 * tracker_appointments was imported once, on 22 August 2026, and nothing has
 * refreshed it since. Four surfaces read it as though it were current: the
 * appointment ledger, the practice-facing portal, the Fulfilment page and
 * lib/metrics. The freshness check in appointment-ledger starts failing the
 * nightly run on 21 September, which is the deadline this sync exists to meet.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not write to the sheet. The scope is spreadsheets.readonly, so a bug
 * here cannot damage the tracker the call centre works in all day.
 *
 * It does not delete. A row that disappears from the sheet is left in the
 * database rather than removed, because the two most likely reasons for a row
 * vanishing are a filter somebody left on and a range that moved — and neither
 * is a reason to destroy a consultation record that billing may reference.
 * Genuine deletions are rare enough to be somebody's decision.
 *
 * It does not match practices by name here. tracker_practice_aliases already
 * owns that, data-driven since 0025, and duplicating the rule in a second place
 * is how two answers to the same question start to diverge.
 */
import {
  HEADER_TO_FIELD,
  IGNORED_HEADERS,
  REQUIRED_FIELDS,
  TRACKER_RANGE,
  normaliseHeader,
} from '@/config/fulfilment-tracker';
import { serverEnv } from '@/lib/env';
import { readSheet } from '@/lib/integrations/google-sheets';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/** Rows written per statement. Large enough to be few round trips, small
 *  enough that one bad row's error names a manageable batch. */
const BATCH = 200;

function text(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A date the sheet displays, as a date the database will accept.
 *
 * Read as FORMATTED_VALUE, so these arrive the way a person sees them —
 * "8/21/2026" rather than a serial number. Deliberately strict: an unparseable
 * date returns null rather than a guess, because booked_for drives billing
 * windows and outcome deadlines, and a date invented from an ambiguous string
 * would be wrong in a way nothing downstream could detect.
 */
function asDate(value: string | undefined): string | null {
  const raw = text(value);
  if (raw === null) return null;

  // M/D/YYYY or MM/DD/YYYY, which is what the tracker displays.
  const slashed = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashed) {
    const [, month, day, year] = slashed;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Already ISO, or close enough that Date agrees.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/**
 * A money cell the sheet displays, as integer cents.
 *
 * "$1,234.56", "1234.56", "($12.34)" and "" all arrive here, because column N
 * is typed by hand. Symbols, thousands separators and stray spaces are
 * stripped; accounting parentheses read as negative, which is what a
 * spreadsheet means by them.
 *
 * Unparseable returns null rather than zero. A spend of zero and a spend
 * nobody has recorded yet are different facts, and averaging over the second
 * as though it were the first would understate cost per booking on every row
 * the call centre had not filled in.
 *
 * Rounded rather than truncated, so a column of odd fractions does not drift
 * by a cent a row.
 */
function asCents(value: string | undefined): number | null {
  const raw = text(value);
  if (raw === null) return null;

  const bracketed = raw.startsWith('(') && raw.endsWith(')');
  const digits = raw.replace(/[^0-9.-]/g, '');
  if (digits === '' || digits === '-' || digits === '.') return null;

  const amount = Number(digits);
  if (!Number.isFinite(amount)) return null;

  const cents = Math.round(Math.abs(amount) * 100);
  return bracketed || amount < 0 ? -cents : cents;
}

/*
 * Exported under test names so check:tracker can exercise them against the
 * real headings without reaching for a sheet or a database. Not for callers.
 */
export { asDate as parseTrackerDateForTests };
export { asCents as parseTrackerMoneyForTests };

export async function syncFulfilmentTracker(ctx: SyncContext): Promise<void> {
  const db = serviceClient();
  const sheetId = serverEnv().FULFILMENT_TRACKER_SHEET_ID;

  if (!sheetId) {
    /*
     * Recorded as a problem, not logged. An unconfigured integration must look
     * different from a working one that read nothing, or it stays
     * unconfigured — the same reasoning windsor-ads uses for a missing
     * ad_account_id.
     */
    ctx.recordError(
      'FULFILMENT_TRACKER_SHEET_ID is not set, so the tracker cannot be read. ' +
        "It is the id in the tracker's own URL, between /d/ and /edit.",
    );
    return;
  }

  const rows = await readSheet(sheetId, TRACKER_RANGE);

  if (rows.length < 2) {
    ctx.recordError(
      `The tracker range ${TRACKER_RANGE} returned ${rows.length} row(s), so ` +
        'there is nothing to import. Check the tab name and that the sheet is ' +
        'shared with the service account.',
    );
    return;
  }

  /*
   * FIND the header row. Do not assume it is the first.
   *
   * The first run read row 1 and found a single cell: "APPOINTMENT DATA". It is
   * a title, spanning the tab the way STATS DASHBOARD puts its section names on
   * row 4 and its column headings on row 5. Assuming row 1 meant the import
   * stopped with "missing required column(s): patient_name, booked_for" while
   * sitting on a sheet that has both.
   *
   * So the header row is the one that recognises the most columns, chosen from
   * the first several rows. That is stronger than hardcoding row 2 as well: it
   * survives somebody adding a note above the table, and it cannot silently
   * pick a data row, because a data row maps nothing.
   */
  const HEADER_SEARCH_ROWS = 8;

  let headerIndex = 0;
  let bestMatches = -1;

  rows.slice(0, HEADER_SEARCH_ROWS).forEach((candidate, index) => {
    const matches = candidate.filter(
      (cell) => HEADER_TO_FIELD.get(normaliseHeader(cell)) !== undefined,
    ).length;
    if (matches > bestMatches) {
      bestMatches = matches;
      headerIndex = index;
    }
  });

  const headerRow = rows[headerIndex];
  const dataRows = rows.slice(headerIndex + 1);

  // Worth recording: if this is ever not 1, the sheet grew a banner and the
  // next person should not have to rediscover why the rows are offset.
  ctx.note('header_row_in_sheet', headerIndex + 1);

  /*
   * The header map, and everything it could not place.
   *
   * This report is the point of the first run. These headers were written from
   * the shape of the existing table rather than from the sheet, because the
   * sheet cannot be read until this exists — so the unmatched list is how the
   * config gets corrected, and it is a note rather than an error because an
   * extra column the Hub has no use for is normal, not a fault.
   */
  const ignored = new Set(IGNORED_HEADERS.map(normaliseHeader));

  const columnOf = new Map<string, number>();
  const unmatched: string[] = [];
  let ignoredSeen = 0;

  (headerRow ?? []).forEach((header, index) => {
    const key = normaliseHeader(header);
    if (key === '') return;
    // Known and deliberately not imported. Counted, not listed, so the
    // unrecognised list below stays worth reading.
    if (ignored.has(key)) {
      ignoredSeen += 1;
      return;
    }
    const field = HEADER_TO_FIELD.get(key);
    if (field === undefined) {
      unmatched.push(header.trim());
      return;
    }
    // First occurrence wins; a duplicated header is reported, not guessed at.
    if (!columnOf.has(field)) columnOf.set(field, index);
  });

  ctx.note('headers_seen', (headerRow ?? []).length);
  ctx.note('headers_mapped', [...columnOf.keys()].sort());
  if (ignoredSeen > 0) ctx.note('headers_ignored_by_design', ignoredSeen);
  if (unmatched.length > 0) ctx.note('headers_unrecognised', unmatched);

  const missingRequired = REQUIRED_FIELDS.filter((field) => !columnOf.has(field));
  if (missingRequired.length > 0) {
    /*
     * Stop rather than import a partial picture. Without a patient name or an
     * appointment date every row is unusable, and writing 1,300 unusable rows
     * over a snapshot that at least made sense is worse than not running.
     */
    ctx.recordError(
      `The tracker is missing required column(s): ${missingRequired.join(', ')}. ` +
        `Headers actually present: ${(headerRow ?? []).join(' | ')}. Add the ` +
        'spelling to TRACKER_COLUMNS in config/fulfilment-tracker rather than ' +
        'renaming the sheet, so the tracker stays whatever its users expect.',
      { missing: missingRequired },
    );
    return;
  }

  const cell = (row: string[], field: string): string | undefined => {
    const index = columnOf.get(field);
    return index === undefined ? undefined : row[index];
  };

  const importedAt = new Date().toISOString();
  const records: Record<string, unknown>[] = [];
  let skippedIncomplete = 0;

  dataRows.forEach((row, offset) => {
    const patient = text(cell(row, 'patient_name'));
    const bookedFor = asDate(cell(row, 'booked_for'));

    if (patient === null || bookedFor === null) {
      skippedIncomplete += 1;
      return;
    }

    records.push({
      // Row 1 is the header, and offset is zero-based, so the sheet's own row
      // number is offset + 2. Keeping the sheet's numbering means a row here
      // can be found by eye in the tracker without arithmetic.
      /*
       * The sheet's own row number, counted from the header wherever it turned
       * out to be. This is the key the ledger joins on and the number somebody
       * uses to find the row by eye, so an offset here silently points every
       * reconciliation at the wrong line.
       */
      source_row: headerIndex + 2 + offset,
      patient_name: patient,
      booked_for: bookedFor,
      location_name: text(cell(row, 'location_name')),
      patient_email: text(cell(row, 'patient_email')),
      created_on: asDate(cell(row, 'created_on')),
      booked_by: text(cell(row, 'booked_by')),
      appointment_status: text(cell(row, 'appointment_status')),
      status_if_showed: text(cell(row, 'status_if_showed')),
      offer_name: text(cell(row, 'offer_name')),
      campaign_external_id: text(cell(row, 'campaign_external_id')),
      adset_external_id: text(cell(row, 'adset_external_id')),
      ad_external_id: text(cell(row, 'ad_external_id')),
      /*
       * Column N, stored and NOT the spend figure the Hub reports. That comes
       * from Windsor at ad-and-day grain and reconciles against Meta day for
       * day. Keeping this one means the two can be compared.
       */
      amount_spent_cents: asCents(cell(row, 'amount_spent')),
      imported_at: importedAt,
    });
  });

  ctx.counts.read = dataRows.length;
  if (skippedIncomplete > 0) {
    ctx.note('skipped_without_name_or_date', skippedIncomplete);
  }

  /*
   * Upsert on the sheet's own row number.
   *
   * source_row is the identity the previous hand import used and the key the
   * ledger already joins on, so keeping it means this sync slots underneath
   * everything downstream without a migration. It also makes a re-run
   * idempotent: the same sheet produces the same rows rather than a second copy.
   */
  for (let start = 0; start < records.length; start += BATCH) {
    const batch = records.slice(start, start + BATCH);
    const written = await db
      .from('tracker_appointments')
      .upsert(batch as never, { onConflict: 'source_row' });

    if (written.error) {
      ctx.recordError(
        `Could not write tracker rows ${start + 2}–${start + batch.length + 1}: ` +
          written.error.message,
        { from: start + 2, count: batch.length },
      );
      return;
    }
    ctx.counts.updated += batch.length;
  }

  /*
   * booked_by is counted anyway, and is expected to be zero.
   *
   * The tracker has no column naming who set an appointment — fourteen
   * headings, none of them a person. Attribution comes from BOOKING SHEET,
   * which sync/booking-sheet imports. Counting it here means the day somebody
   * adds the column to the tracker, this line is what notices.
   */
  const named = records.filter((row) => row['booked_by'] !== null).length;
  const priced = records.filter((row) => row['amount_spent_cents'] !== null).length;

  ctx.log(
    `${records.length} tracker row(s) imported from the sheet. ` +
      `${priced} carry a spend figure. ` +
      (named === 0
        ? 'None name who booked them — the tracker has no such column, so ' +
          'attribution comes from BOOKING SHEET.'
        : `${named} name who booked them.`),
  );
}

