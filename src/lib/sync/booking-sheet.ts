/**
 * Import the two tabs that decide ISA pay.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The commission work was built against tracker_appointments.booked_by, from
 * the Client Fulfilment Tracker. Reading the live formulas showed nothing in the
 * pay chain touches that file: DAILY BONUS TALLY counts BOOKING SHEET by agent
 * and date, subtracts twice the matching INVALID BOOKINGS rows, and STATS
 * DASHBOARD — the sheet carrying Comms, Bonus and Salary — reads the tally.
 *
 * So this imports what is actually paid from, which makes the Hub's figures
 * reconcilable against what agents already see. That reconciliation is the
 * point: until a number here matches Karol's $600 and Ayanda's $552 on the
 * dashboard, nobody should be paid from the Hub.
 *
 * It writes nothing back. Scope is spreadsheets.readonly, so a bug here cannot
 * damage the sheet the call centre works in all day, and it cannot alter what
 * anybody is currently paid.
 */
import {
  BOOKING_SHEET_COLUMNS,
  BOOKING_SHEET_RANGE,
  INVALID_BOOKINGS_COLUMNS,
  INVALID_BOOKINGS_RANGE,
  PAYABLE_FIELDS,
  normaliseSheetHeader,
} from '@/config/booking-sheet';
import { serverEnv } from '@/lib/env';
import { parseSheetDate } from '@/lib/sheet-dates';
import { findHeaderRow } from '@/lib/sheet-headers';
import { listSheetTitles, readSheet } from '@/lib/integrations/google-sheets';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

const BATCH = 200;

function text(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** Map headers to fields, reporting whatever could not be placed. */
function mapHeaders(
  headerRow: string[] | undefined,
  columns: Readonly<Record<string, string>>,
): { columnOf: Map<string, number>; unmatched: string[] } {
  const columnOf = new Map<string, number>();
  const unmatched: string[] = [];

  (headerRow ?? []).forEach((header, index) => {
    const key = normaliseSheetHeader(header);
    if (key === '') return;
    const field = columns[key];
    if (field === undefined) {
      unmatched.push(header.trim());
      return;
    }
    if (!columnOf.has(field)) columnOf.set(field, index);
  });

  return { columnOf, unmatched };
}

export async function syncBookingSheet(ctx: SyncContext): Promise<void> {
  const sheetId = serverEnv().COMMISSION_INPUTS_SHEET_ID;

  if (!sheetId) {
    ctx.recordError(
      'COMMISSION_INPUTS_SHEET_ID is not set, so the booking sheet cannot be ' +
        'read. It is the "Apex - Call Center Agent Dashboard" spreadsheet, which ' +
        'holds BOOKING SHEET, INVALID BOOKINGS and INPUT VALUES.',
    );
    return;
  }

  const db = serviceClient();

  let bookings: string[][];
  try {
    bookings = await readSheet(sheetId, BOOKING_SHEET_RANGE);
  } catch (error) {
    let tabs: string[] = [];
    try {
      tabs = await listSheetTitles(sheetId);
    } catch {
      // Already failing; the tab list is a courtesy.
    }
    ctx.recordError(
      `Could not read ${BOOKING_SHEET_RANGE}: ` +
        `${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
      { tabs },
    );
    return;
  }

  if (bookings.length < 2) {
    ctx.recordError(
      `${BOOKING_SHEET_RANGE} returned ${bookings.length} row(s), so there is ` +
        'nothing to import.',
    );
    return;
  }

  /*
   * Find the header row rather than taking the first.
   *
   * This tab has never been read, so its shape is unverified — and the one tab
   * in this family that HAS been read opens with a merged banner and puts its
   * headings on row 4. Assuming row 1 there cost two runs. Cheaper to look.
   */
  const bookingHead = findHeaderRow(bookings, (cell) =>
    Object.prototype.hasOwnProperty.call(
      BOOKING_SHEET_COLUMNS,
      normaliseSheetHeader(cell),
    ),
  );

  const bookingHeader = bookings[bookingHead.index];
  const bookingRows = bookings.slice(bookingHead.index + 1);
  const booking = mapHeaders(bookingHeader, BOOKING_SHEET_COLUMNS);

  ctx.note('booking_header_row_in_sheet', bookingHead.sheetRow);
  /*
   * The header row as the sheet actually spells it, always — not only on
   * failure.
   *
   * The first successful run read 383 bookings and dated none of them, while
   * reporting booked_on as mapped. A mapped column that yields nothing on every
   * row means the header matched something that is not the date column, and
   * without the raw headings there is no way to tell which. Printing them costs
   * one line and is the difference between diagnosing that in one run and in
   * three.
   */
  ctx.note('booking_headers_in_sheet', (bookingHeader ?? []).map((h) => h.trim()));
  ctx.note('booking_headers_mapped', [...booking.columnOf.keys()].sort());
  if (booking.unmatched.length > 0) {
    ctx.note('booking_headers_unrecognised', booking.unmatched);
  }

  const missing = PAYABLE_FIELDS.filter((field) => !booking.columnOf.has(field));
  if (missing.length > 0) {
    ctx.recordError(
      `BOOKING SHEET is missing ${missing.join(', ')}, without which no booking ` +
        `can be paid. Headers present: ${(bookingHeader ?? []).join(' | ')}.`,
      { missing },
    );
    return;
  }

  const cellOf =
    (columnOf: Map<string, number>) =>
    (row: string[], field: string): string | undefined => {
      const index = columnOf.get(field);
      return index === undefined ? undefined : row[index];
    };

  const bookingCell = cellOf(booking.columnOf);
  const importedAt = new Date().toISOString();

  const records: Record<string, unknown>[] = [];
  let blankAgent = 0;
  let blankDate = 0;
  let ambiguousDates = 0;
  const dispositions = new Map<string, number>();

  /*
   * Empty and unparseable are different faults with different fixes.
   *
   * A blank cell means the mapping points at the wrong column, or the sheet
   * genuinely has no date there. A non-blank cell that will not parse means
   * the format is one parseSheetDate has not seen — a serial number, a
   * timestamp, a locale spelling. Counting them apart says which without
   * anybody opening the sheet, and neither count is a patient detail.
   */
  let dateCellEmpty = 0;
  let dateCellUnparseable = 0;
  const unparseableShapes = new Set<string>();

  bookingRows.forEach((row, offset) => {
    const agent = text(bookingCell(row, 'agent'));
    const rawDate = bookingCell(row, 'date');
    const parsed = parseSheetDate(rawDate, 'month-first');

    if (parsed.date === null) {
      const trimmed = (rawDate ?? '').trim();
      if (trimmed === '') {
        dateCellEmpty += 1;
      } else {
        dateCellUnparseable += 1;
        /*
         * The SHAPE, never the value. Digits become 9 and letters X, so
         * "9/3/2026" is reported as "9/9/9999" and "Sept 3" as "XXXX 9" —
         * enough to recognise a format, and nothing that identifies anybody.
         */
        if (unparseableShapes.size < 5) {
          unparseableShapes.add(
            trimmed.slice(0, 24).replace(/[0-9]/g, '9').replace(/[A-Za-z]/g, 'X'),
          );
        }
      }
    }
    const disposition = text(bookingCell(row, 'disposition'));

    // An entirely empty row is spreadsheet padding, not a booking.
    if (agent === null && parsed.date === null && disposition === null) return;

    /*
     * A row with no agent is imported, not skipped.
     *
     * It contributes to nobody's COUNTIFS in the sheet either, which is the
     * problem: roughly half of September's rows have a blank agent, so those
     * bookings are silently unpaid and nothing anywhere says so. Importing them
     * and counting them is how that becomes visible.
     */
    if (agent === null) blankAgent += 1;
    if (parsed.date === null) blankDate += 1;
    if (parsed.ambiguous) ambiguousDates += 1;
    if (disposition !== null) {
      dispositions.set(disposition, (dispositions.get(disposition) ?? 0) + 1);
    }

    records.push({
      /*
       * The sheet's own row number, counted from wherever the header turned
       * out to be — not from row 1.
       *
       * This is both the upsert key and the number somebody uses to find the
       * row by eye, so an offset here points every reconciliation at the wrong
       * line while looking entirely plausible.
       */
      source_row: bookingHead.index + 2 + offset,
      booked_on: parsed.date,
      agent,
      patient_name: text(bookingCell(row, 'patient_name')),
      patient_email: text(bookingCell(row, 'patient_email')),
      location_name: text(bookingCell(row, 'location_name')),
      disposition,
      imported_at: importedAt,
    });
  });

  ctx.counts.read = bookingRows.length;

  for (let start = 0; start < records.length; start += BATCH) {
    const batch = records.slice(start, start + BATCH);
    const written = await db
      .from('booking_sheet_rows')
      .upsert(batch as never, { onConflict: 'source_row' });

    if (written.error) {
      ctx.recordError(
        `Could not write booking rows ${start + 2}–${start + batch.length + 1}: ` +
          written.error.message,
      );
      return;
    }
    ctx.counts.updated += batch.length;
  }

  /*
   * The disposition values, which is the point of importing the column.
   *
   * Whether the daily bonus can exclude no-shows depends entirely on whether
   * this carries attendance. If it does not, the question is settled by the data
   * rather than by anybody's preference.
   */
  ctx.note(
    'dispositions',
    [...dispositions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
  );

  if (blankAgent > 0) {
    /*
     * An error, not a note. These are bookings somebody made and will not be
     * paid for, and the sheet gives no sign of it — so this has to arrive
     * somewhere a person looks rather than in a field they have to go and read.
     */
    ctx.recordError(
      `${blankAgent} of ${records.length} booking(s) name no agent, so they are ` +
        'attributed to nobody and go unpaid. This is a data-entry gap in the ' +
        'sheet, not a fault in this sync.',
      { blankAgent },
    );
  }
  if (blankDate > 0) ctx.note('bookings_without_a_date', blankDate);
  if (dateCellEmpty > 0) ctx.note('date_cell_was_empty', dateCellEmpty);
  if (dateCellUnparseable > 0) {
    ctx.note('date_cell_unparseable', dateCellUnparseable);
    ctx.note('date_shapes_seen', [...unparseableShapes]);
  }
  if (ambiguousDates > 0) {
    ctx.note(
      'dates_read_month_first_but_ambiguous',
      `${ambiguousDates} row(s) had both parts 12 or under, so the order could ` +
        'not be settled from the value alone.',
    );
  }

  await importInvalidBookings(ctx, db, sheetId, importedAt);

  ctx.log(
    `${records.length} booking(s) imported from BOOKING SHEET, ` +
      `${records.length - blankAgent} attributed to an agent.`,
  );
}

/**
 * The invalid-booking reports, from the hidden form-linked tab.
 *
 * Hidden in the spreadsheet UI, which the API ignores — values.get returns a
 * hidden tab exactly as it returns a visible one. Worth stating because the
 * alternative was asking a person to unhide it, and unhiding a tab on a shared
 * file changes what everybody else sees.
 *
 * Never fails the run. The bookings are what this sync is for, and an empty or
 * renamed form tab must not cost us them.
 */
async function importInvalidBookings(
  ctx: SyncContext,
  db: ReturnType<typeof serviceClient>,
  sheetId: string,
  importedAt: string,
): Promise<void> {
  let rows: string[][];
  try {
    rows = await readSheet(sheetId, INVALID_BOOKINGS_RANGE);
  } catch (error) {
    ctx.note(
      'invalid_bookings_unread',
      error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    );
    return;
  }

  if (rows.length < 2) {
    // Zero reports is a real and important answer, not a failure: it means the
    // penalty mechanism has never fired on a live booking.
    ctx.note('invalid_bookings', 0);
    return;
  }

  // Same treatment as BOOKING SHEET above, and for the same reason.
  const invalidHead = findHeaderRow(rows, (cell) =>
    Object.prototype.hasOwnProperty.call(
      INVALID_BOOKINGS_COLUMNS,
      normaliseSheetHeader(cell),
    ),
  );

  const header = rows[invalidHead.index];
  const dataRows = rows.slice(invalidHead.index + 1);
  const { columnOf, unmatched } = mapHeaders(header, INVALID_BOOKINGS_COLUMNS);

  ctx.note('invalid_header_row_in_sheet', invalidHead.sheetRow);
  if (unmatched.length > 0) ctx.note('invalid_headers_unrecognised', unmatched);

  if (!columnOf.has('agent')) {
    ctx.note(
      'invalid_bookings_unusable',
      `no agent column found; headers are: ${(header ?? []).join(' | ')}`,
    );
    return;
  }

  const records: Record<string, unknown>[] = [];

  dataRows.forEach((row, offset) => {
    const agent = text(row[columnOf.get('agent')!]);
    const stamp = text(
      columnOf.has('reported_at') ? row[columnOf.get('reported_at')!] : undefined,
    );
    // The form writes its own date field; same convention as BOOKING SHEET,
    // since both are entered by the same people in the same locale.
    const invalidOn = parseSheetDate(
      columnOf.has('invalid_on') ? row[columnOf.get('invalid_on')!] : undefined,
      'month-first',
    );

    if (agent === null && stamp === null) return;

    const reportedAt = stamp === null ? null : new Date(stamp);

    records.push({
      // Counted from the discovered header, as above.
      source_row: invalidHead.index + 2 + offset,
      // The form's timestamp, kept apart from the date the booking was made —
      // the tally matches on the latter.
      reported_at:
        reportedAt && !Number.isNaN(reportedAt.getTime())
          ? reportedAt.toISOString()
          : null,
      invalid_on: invalidOn.date,
      agent,
      reason: columnOf.has('reason') ? text(row[columnOf.get('reason')!]) : null,
      notes: columnOf.has('notes') ? text(row[columnOf.get('notes')!]) : null,
      imported_at: importedAt,
    });
  });

  if (records.length === 0) {
    ctx.note('invalid_bookings', 0);
    return;
  }

  const written = await db
    .from('invalid_booking_reports')
    .upsert(records as never, { onConflict: 'source_row' });

  if (written.error) {
    ctx.note('invalid_bookings_not_stored', written.error.message);
    return;
  }

  ctx.note('invalid_bookings', records.length);
}
