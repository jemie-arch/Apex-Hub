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
  INPUT_VALUES_TAB,
  REQUIRED_FIELDS,
  TRACKER_RANGE,
  UNIT_VALUE_CELL,
  normaliseHeader,
} from '@/config/fulfilment-tracker';
import { serverEnv } from '@/lib/env';
import { listSheetTitles, readSheet } from '@/lib/integrations/google-sheets';
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

  const [headerRow, ...dataRows] = rows;

  /*
   * The header map, and everything it could not place.
   *
   * This report is the point of the first run. These headers were written from
   * the shape of the existing table rather than from the sheet, because the
   * sheet cannot be read until this exists — so the unmatched list is how the
   * config gets corrected, and it is a note rather than an error because an
   * extra column the Hub has no use for is normal, not a fault.
   */
  const columnOf = new Map<string, number>();
  const unmatched: string[] = [];

  (headerRow ?? []).forEach((header, index) => {
    const key = normaliseHeader(header);
    if (key === '') return;
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
      source_row: offset + 2,
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

  ctx.log(
    `${records.length} tracker row(s) imported from the sheet. ` +
      `${records.filter((row) => row['booked_by'] !== null).length} name who booked them.`,
  );

  await readCommissionUnitValue(ctx, db, sheetId);
}

/**
 * Pick up what one commission unit is worth, from the sheet that owns it.
 *
 * Kept out of the import above and never allowed to fail the run. The rate is
 * useful, and the 1,300 consultation records are the point — a missing tab must
 * not cost us the import.
 *
 * Stored rather than returned so the commission page can price units without a
 * second Google round trip on every request, and so the figure has a visible
 * last-read time when somebody asks why a payslip changed.
 */
async function readCommissionUnitValue(
  ctx: SyncContext,
  db: ReturnType<typeof serviceClient>,
  sheetId: string,
): Promise<void> {
  let titles: string[];
  try {
    titles = await listSheetTitles(sheetId);
  } catch (error) {
    ctx.note(
      'unit_value_unread',
      `could not list the tabs: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    return;
  }

  const tab = titles.find((title) => INPUT_VALUES_TAB.test(title));
  if (tab === undefined) {
    // The real titles, so the pattern can be corrected from one run rather than
    // from a series of guesses.
    ctx.note('unit_value_tab_not_found', titles);
    return;
  }

  let cells: string[][];
  try {
    cells = await readSheet(sheetId, `${tab}!${UNIT_VALUE_CELL}`);
  } catch (error) {
    ctx.note(
      'unit_value_unread',
      `${tab}!${UNIT_VALUE_CELL}: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    return;
  }

  const raw = cells[0]?.[0]?.trim() ?? '';

  /*
   * Read as currency a person typed: "$2.00", "2", "2.50", maybe with a comma.
   * Anything else is reported rather than coerced — a rate silently parsed to 0
   * would pay nobody, and a rate parsed to 200 would pay a hundredfold.
   */
  const numeric = Number(raw.replace(/[^0-9.-]/g, ''));
  if (raw === '' || !Number.isFinite(numeric) || numeric <= 0) {
    ctx.note('unit_value_unusable', raw === '' ? '(empty)' : raw);
    return;
  }

  const cents = Math.round(numeric * 100);

  const written = await db.from('app_settings').upsert(
    {
      key: 'isa_commission_unit_cents',
      value: cents,
      description:
        `One ISA commission unit, read from ${tab}!${UNIT_VALUE_CELL} of the ` +
        'fulfilment tracker. Change it in the sheet, not here — the next run ' +
        'overwrites this.',
    },
    { onConflict: 'key' },
  );

  if (written.error) {
    ctx.note('unit_value_not_stored', written.error.message);
    return;
  }

  ctx.note('unit_value_cents', cents);
}
