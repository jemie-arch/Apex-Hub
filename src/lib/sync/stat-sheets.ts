/**
 * Appointments from every practice's own stat sheet.
 *
 * Each practice has one. Their ids are in pps_clinic_routing, verified in
 * September by reading the Location ID column out of each live sheet and
 * matching it to crm_location_id — so the set of sheets is known and checked,
 * and no Drive folder listing is needed. That matters: the Hub's Google scope
 * is spreadsheets.readonly, which reads a sheet by id and cannot list a folder.
 *
 * HEADER-DRIVEN, NOT COLUMN-LETTER-DRIVEN, and that is not a stylistic
 * preference. The sheet's own labels are already known to mislead — it heads
 * two different columns "Ad ID" and "Ad Name" and fills both from the same
 * GoHighLevel field. Reading by position would bake that in; reading by header
 * means a sheet that differs is reported rather than silently misparsed.
 *
 * ALL 49 SHEETS WERE AUDITED ON 14 SEPTEMBER, and the two things that matter
 * are settled.
 *
 * Ad ID is empty on 41 of 46 audited. Five carry anything at all and only four
 * hold real Meta ad ids — 22 rows across roughly 1,113. Singleton Smile has 13
 * and is the only practice with enough distinct ads to compare two creatives.
 * So a booking cannot be traced to an ad, fleet-wide, and the ~250 ads planned
 * for October cannot be measured on bookings unless utm_content starts
 * carrying the ad id BEFORE they run.
 *
 * Campaign ID is populated 121 times and Treatment Value 308 — nearly four and
 * ten times the ad column. Campaign grain and case value work where ad grain
 * does not.
 *
 * NINE SHEETS USE AN OLDER LAYOUT, which is why this file reads by header and
 * not by column letter. On those, W is "Make Remarks" rather than Date Booked,
 * and everything after shifts one left: Ad ID sits at Z, AB holds "First
 * Called", and AC/AD do not exist. Reading by position would have pulled a
 * call timestamp into the ad column for a fifth of the fleet and reported it
 * as attribution.
 */
import { findHeaderRow } from '@/lib/sheet-headers';
import { readSheet } from '@/lib/integrations/google-sheets';
import { serviceClient } from '@/lib/supabase/service';
import type { SyncContext } from '@/lib/sync/runner';
import type { Database } from '@/types/database';

type StatSheetRow =
  Database['public']['Tables']['stat_sheet_appointments']['Insert'];

/** A tab plus enough columns for A to AD. */
const RANGE = 'MASTER!A1:AD20000';

/** Rows written per statement. Sheets of a few thousand rows are normal. */
const BATCH = 400;

const normalise = (header: string): string =>
  header.toLowerCase().replace(/[\s\n\r]+/g, ' ').replace(/[^a-z0-9 ()/+?.]/g, '').trim();

/*
 * Sheet heading -> column on stat_sheet_appointments.
 *
 * Written from the Make blueprints that populate these sheets. Headings carry
 * newlines and trailing letters in brackets in the real file, which normalise()
 * flattens, so several spellings map to one field on purpose.
 */
const HEADER_TO_FIELD = new Map<string, string>([
  ['name', 'patient_name'],
  ['email', 'patient_email'],
  ['phone', 'patient_phone'],
  ['phone (+)', 'phone_plus'],
  ['date added', 'date_added'],
  ['app date', 'appointment_on'],
  ['appt. date time', 'appointment_at'],
  ['appt date time', 'appointment_at'],
  ['date booked', 'booked_on'],
  ['cc on file (y/n)', 'cc_on_file'],
  ['cc on file', 'cc_on_file'],
  ['additonal notes', 'notes'],
  ['additional notes', 'notes'],
  ['source', 'lead_source'],
  ['confirm?', 'confirmed'],
  ['first consultation show (y/n)', 'first_consultation_show'],
  ['second consultation show (y/n)', 'second_consultation_show'],
  ['converted to patient?', 'converted_to_patient'],
  ['approved for credit plan?', 'credit_plan_approved'],
  ['charged?', 'charged'],
  ['appointment id', 'appointment_external_id'],
  ['location name', 'location_name'],
  ['location id', 'location_external_id'],
  ['offer name', 'offer_name'],
  /*
   * Read on 14 September, so these are the sheets' real headings rather than
   * the inference this file shipped with. Two were missing entirely.
   */
  ['treatment value (only input if new patient)', 'treatment_value'],
  [
    /*
     * No apostrophe. normalise() strips it from the sheet's header, and these
     * keys are compared against the normalised form - so a key that keeps its
     * punctuation can never match. The first run reported this column as
     * unmatched, which is what the unmatched report is for.
     */
    "notes (feedback on appointment or additional info on why they didnt convert)",
    'outcome_notes',
  ],
  /*
   * The ad columns. Campaign ID is a real Meta campaign id and resolves to the
   * right practice — checked for City Dental, Bespoke and Fiesta. Ad ID is
   * empty in every sheet read, because the ads do not set utm_content; it is
   * mapped anyway so it fills by itself the day that is configured.
   */
  ['campaign id', 'campaign_external_id'],
  ['campaign name', 'utm_campaign'],
  ['ad set id', 'adset_external_id'],
  ['ad set name', 'adset_name'],
  ['ad id', 'ad_external_id'],
  ['ad name', 'ad_name'],
]);

/**
 * A money cell as integer cents.
 *
 * Treatment Value is the only case value recorded anywhere in the business, so
 * it is worth parsing carefully rather than coercing. Anything that is not a
 * number is null, never zero: "no value entered" and "the case was worth
 * nothing" are different facts and one of them is common.
 */
function asCents(value: string | undefined): number | null {
  const raw = text(value);
  if (raw === null) return null;

  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;

  const amount = Number.parseFloat(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return null;

  return Math.round(amount * 100);
}

/** Known and deliberately not imported, so the unmatched list stays readable. */
const IGNORED = new Set(
  [
    'month',
    'utm parameters',
    /*
     * The nine older sheets carry these two instead of Date Booked and the
     * AC/AD pair. Listed so they are silently skipped rather than filling the
     * unmatched report with a known difference on every run — which would bury
     * a genuinely new column.
     */
    'make remarks',
    'first called',
    '',
  ].map(normalise),
);

const text = (value: string | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed.slice(0, 2000);
};

/** A sheet date, as a date the database will take. Null rather than a guess. */
function asDate(value: string | undefined): string | null {
  const raw = text(value);
  if (raw === null) return null;

  // ISO first: unambiguous, and what a pasted value usually is.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  /*
   * US order, because these sheets are written by US practices and Google
   * renders them M/D/YYYY. Assuming the other order silently moves bookings
   * between months for eleven days of every twelve — the same mistake that put
   * 70 call rows in the future in September.
   */
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

function asInstant(value: string | undefined): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Does this look like a Meta object id?
 *
 * Meta ids are long integers — fifteen digits and up. A creative called
 * "Aligners 7" or a blank is not one. Used only to COUNT, never to filter: the
 * value is stored either way and this decides what the run reports.
 */
const looksLikeMetaId = (value: string | null): boolean =>
  value !== null && /^\d{10,}$/.test(value);

interface SheetTarget {
  clientId: string;
  practice: string;
  spreadsheetId: string;
}

export async function syncStatSheets(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  const routing = await db
    .from('pps_clinic_routing')
    .select('client_id, practice, spreadsheet_id')
    .not('client_id', 'is', null);

  if (routing.error) {
    ctx.recordError(`Could not read the routing table: ${routing.error.message}`);
    return;
  }

  const targets: SheetTarget[] = [];
  const seen = new Set<string>();

  for (const row of routing.data ?? []) {
    if (!row.client_id || !row.spreadsheet_id) continue;
    // One practice can appear twice in routing; one sheet is read once.
    const key = `${row.client_id}::${row.spreadsheet_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      clientId: row.client_id,
      practice: row.practice ?? 'Unnamed',
      spreadsheetId: row.spreadsheet_id,
    });
  }

  if (targets.length === 0) {
    ctx.recordError(
      'No practice in pps_clinic_routing has both a client and a spreadsheet id, ' +
        'so there is no stat sheet to read.',
    );
    return;
  }

  ctx.note('sheets_to_read', targets.length);

  const unmatchedHeaders = new Set<string>();
  let sheetsRead = 0;
  let sheetsFailed = 0;

  /* The open question, answered by counting rather than by assertion. */
  let adCellsPopulated = 0;
  let adCellsLookingLikeMetaIds = 0;
  let campaignCellsPopulated = 0;
  let campaignCellsNotLookingLikeIds = 0;
  let treatmentValuesPopulated = 0;

  for (const target of targets) {
    let rows: string[][];

    try {
      rows = await readSheet(target.spreadsheetId, RANGE);
    } catch (error) {
      /*
       * One unreadable sheet must not lose the other forty-eight. The usual
       * cause is the sheet not being shared with the service account, which is
       * a per-practice fact and worth naming per practice.
       */
      sheetsFailed += 1;
      ctx.recordError(
        `${target.practice}: could not read the stat sheet. ${
          error instanceof Error ? error.message : 'Unknown error.'
        }`,
        { spreadsheetId: target.spreadsheetId },
      );
      continue;
    }

    if (rows.length < 2) {
      sheetsFailed += 1;
      ctx.recordError(
        `${target.practice}: ${RANGE} returned ${rows.length} row(s). Check the ` +
          'tab is still called MASTER and the sheet is shared with the service account.',
      );
      continue;
    }

    const { index: headerIndex, sheetRow } = findHeaderRow(rows, (cell) =>
      HEADER_TO_FIELD.has(normalise(cell)),
    );

    const headerRow = rows[headerIndex] ?? [];
    const columnOf = new Map<string, number>();

    headerRow.forEach((header, index) => {
      const key = normalise(header);
      if (key === '' || IGNORED.has(key)) return;
      const field = HEADER_TO_FIELD.get(key);
      if (field === undefined) {
        unmatchedHeaders.add(header.trim().slice(0, 60));
        return;
      }
      // First occurrence wins. Two columns share a heading in this family of
      // sheet, and guessing which one was meant is how a column goes wrong.
      if (!columnOf.has(field)) columnOf.set(field, index);
    });

    const at = (row: string[], field: string): string | undefined => {
      const index = columnOf.get(field);
      return index === undefined ? undefined : row[index];
    };

    const records: StatSheetRow[] = [];

    rows.slice(headerIndex + 1).forEach((row, offset) => {
      const name = text(at(row, 'patient_name'));
      const external = text(at(row, 'appointment_external_id'));

      /*
       * A row with neither a name nor an appointment id is a spacer, a total,
       * or an empty row below the table. Skipped rather than stored as a row
       * of nulls that would then need explaining.
       */
      if (name === null && external === null) return;

      /*
       * Two of the three sheets carry a row reading "DON'T DELETE THIS ROW" in
       * column A, directly under the headers. It is a guard somebody added so
       * an automation appending rows cannot land on the header, and it is not
       * an appointment.
       */
      if (name !== null && /don'?t delete this row/i.test(name)) return;

      const adCell = text(at(row, 'ad_external_id'));
      if (adCell !== null) {
        adCellsPopulated += 1;
        if (looksLikeMetaId(adCell)) adCellsLookingLikeMetaIds += 1;
      }

      const campaignCell = text(at(row, 'campaign_external_id'));
      if (campaignCell !== null) {
        campaignCellsPopulated += 1;
        /*
         * Integrity Dental's Campaign ID column holds a 14-digit number and its
         * Ad Set ID column holds "Apex | $3679 For Invisalign" — the columns
         * are mismapped at source on that sheet. Counted rather than filtered,
         * because the fix belongs in the sheet and silently dropping the rows
         * would hide that it needs one.
         */
        if (!looksLikeMetaId(campaignCell)) campaignCellsNotLookingLikeIds += 1;
      }
      if (asCents(at(row, 'treatment_value')) !== null) treatmentValuesPopulated += 1;

      records.push({
        client_id: target.clientId,
        spreadsheet_id: target.spreadsheetId,
        // The sheet's own row number, so a person can go and look at it.
        source_row: headerIndex + 1 + offset + 1,
        appointment_external_id: external,
        patient_name: name,
        patient_email: text(at(row, 'patient_email')),
        // The plus-prefixed column is the better number when both exist.
        patient_phone:
          text(at(row, 'phone_plus')) ?? text(at(row, 'patient_phone')),
        date_added: asDate(at(row, 'date_added')),
        appointment_on: asDate(at(row, 'appointment_on')),
        appointment_at: asInstant(at(row, 'appointment_at')),
        booked_on: asDate(at(row, 'booked_on')),
        cc_on_file: text(at(row, 'cc_on_file')),
        confirmed: text(at(row, 'confirmed')),
        first_consultation_show: text(at(row, 'first_consultation_show')),
        second_consultation_show: text(at(row, 'second_consultation_show')),
        converted_to_patient: text(at(row, 'converted_to_patient')),
        credit_plan_approved: text(at(row, 'credit_plan_approved')),
        charged: text(at(row, 'charged')),
        lead_source: text(at(row, 'lead_source')),
        offer_name: text(at(row, 'offer_name')),
        notes: text(at(row, 'notes')),
        location_name: text(at(row, 'location_name')),
        location_external_id: text(at(row, 'location_external_id')),
        campaign_external_id: text(at(row, 'campaign_external_id')),
        adset_external_id: text(at(row, 'adset_external_id')),
        adset_name: text(at(row, 'adset_name')),
        ad_external_id: adCell,
        ad_name: text(at(row, 'ad_name')),
        utm_campaign: text(at(row, 'utm_campaign')),
        treatment_value_cents: asCents(at(row, 'treatment_value')),
        outcome_notes: text(at(row, 'outcome_notes')),
        synced_at: new Date().toISOString(),
      });
    });

    ctx.counts.read += records.length;

    for (let index = 0; index < records.length; index += BATCH) {
      const slice = records.slice(index, index + BATCH);

      const written = await db
        .from('stat_sheet_appointments')
        .upsert(slice, { onConflict: 'client_id,spreadsheet_id,source_row' });

      if (written.error) {
        ctx.recordError(
          `${target.practice}: writing rows failed. ${written.error.message}`,
        );
        break;
      }

      ctx.counts.updated += slice.length;
    }

    sheetsRead += 1;
    if (sheetRow !== 1) ctx.note(`header_row_${target.practice}`, sheetRow);
  }

  ctx.note('sheets_read', sheetsRead);
  ctx.note('sheets_failed', sheetsFailed);

  if (unmatchedHeaders.size > 0) {
    // A note, not an error: an extra column the Hub has no use for is normal.
    ctx.note('unmatched_headers', [...unmatchedHeaders].sort());
  }

  /*
   * The answer to the question this sync was built to settle.
   *
   * If most populated "Ad ID" cells look like Meta ids, these sheets are the
   * missing link between a booking and the creative that produced it, and
   * creative testing can be measured on bookings rather than clicks. If they
   * do not, the column is names or rubbish and nothing downstream should be
   * built on it.
   */
  ctx.note('ad_column_populated', adCellsPopulated);
  ctx.note('ad_column_looks_like_meta_id', adCellsLookingLikeMetaIds);
  /*
   * Campaign is the column that actually works today, so its coverage is the
   * number worth watching. Treatment value is the only case value recorded
   * anywhere in the business, and how sparse it is decides whether revenue can
   * ever be reported.
   */
  ctx.note('campaign_column_populated', campaignCellsPopulated);
  ctx.note('campaign_column_not_an_id', campaignCellsNotLookingLikeIds);
  ctx.note('treatment_value_populated', treatmentValuesPopulated);
}
