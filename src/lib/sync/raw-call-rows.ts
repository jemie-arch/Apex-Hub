/**
 * Import the RAW DATA tab — the tab agent pay is actually calculated from.
 *
 * WHY THIS EXISTS
 *
 * Agent pay would not reconcile. The Hub said 59 and 68 bookings for two agents
 * where the dashboard said 63 and 54 — disagreeing in OPPOSITE directions,
 * which ruled out the date window and every other single-cause explanation.
 *
 * Reading the dashboard's own formula settled it. Cell J2 of STATS DASHBOARD:
 *
 *   COUNTIFS('RAW DATA'!C:C, <agent>, 'RAW DATA'!N:N, "*Booked*", <date bounds>)
 *
 * The dashboard counts the RAW DATA tab. The Hub counted the BOOKING SHEET tab.
 * Neither was wrong — they were answering different questions about different
 * sheets. Nothing reconciles until the Hub reads the same tab, which is this.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not write to the sheet or to Make: scope is spreadsheets.readonly.
 *
 * It does not import patient data. Make scenario 5560467 module #5 writes 22
 * values and four of them are patient identifiers — last_name, email,
 * first_name and mobile. None is needed to count a booking or measure an agent,
 * so none is read. See src/config/raw-call-rows.ts.
 *
 * It does not delete. A row removed from the sheet stays here; a call that
 * happened, happened.
 *
 * It does not calculate pay. It supplies the count. The commission scheme
 * already lives in app_settings.isa_commission_scheme, and its values were
 * confirmed against the sheet's own INPUT VALUES block: unitAmount 800 = B12
 * $8, quota1Amount 1000 = B13 $10, quota2Amount 1200 = B14 $12, thresholds 96
 * and 128 = B15 and B16.
 */
import {
  RAW_CALL_HEADER_TO_FIELD,
  RAW_CALL_POSITIONAL_ORDER,
  RAW_CALL_REQUIRED_FIELDS,
  RAW_CALL_SHEET_ID,
  RAW_CALL_TAB_CANDIDATES,
  looksLikeRawTab,
  normaliseRawHeader,
} from '@/config/raw-call-rows';
import { listSheetTitles, readSheet } from '@/lib/integrations/google-sheets';
import { findHeaderRow } from '@/lib/sheet-headers';
import { asDate, asInstant, asSeconds, text } from '@/lib/sheet-values';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/*
 * Larger than the call-summaries batch of 50. No row here carries a
 * transcript — the widest column is a phone number — so the payload per row is
 * small and the tab is long.
 */
const BATCH = 500;

export async function syncRawCallRows(ctx: SyncContext): Promise<void> {
  const db = serviceClient();
  const sheetId = RAW_CALL_SHEET_ID;

  let tabs: string[];
  try {
    tabs = await listSheetTitles(sheetId);
  } catch (error) {
    ctx.recordError(
      `Could not list the tabs of ${sheetId}: ${
        error instanceof Error ? error.message.slice(0, 300) : 'unknown'
      }`,
    );
    return;
  }

  const named = RAW_CALL_TAB_CANDIDATES.find((candidate) =>
    tabs.some((tab) => tab.trim().toLowerCase() === candidate.toLowerCase()),
  );
  const tab =
    (named && tabs.find((t) => t.trim().toLowerCase() === named.toLowerCase())) ??
    tabs.find(looksLikeRawTab);

  if (!tab) {
    ctx.recordError(
      'No tab looks like the raw call feed. Tabs present: ' +
        `${tabs.join(' | ')}. The Make scenario writes to "RAW DATA"; add the ` +
        'real name to RAW_CALL_TAB_CANDIDATES rather than renaming the sheet.',
      { tabs },
    );
    return;
  }

  ctx.note('raw_tab_chosen', tab);

  let rows: string[][];
  try {
    // The scenario writes 22 columns, A to V. A:Z leaves room for a person
    // having added one on the end without breaking the read.
    rows = await readSheet(sheetId, `${tab}!A:Z`);
  } catch (error) {
    ctx.recordError(
      `Could not read ${tab}: ${
        error instanceof Error ? error.message.slice(0, 300) : 'unknown'
      }`,
      { tabs },
    );
    return;
  }

  if (rows.length === 0) {
    ctx.recordError(
      `The "${tab}" tab is empty. Make scenario 5560467 is the only thing that ` +
        'writes it. If it has just been reactivated, the backlog may still be ' +
        'draining; if it is switched off, nothing will appear here.',
      { tab },
    );
    return;
  }

  /*
   * Find the header row, and cope with there being none.
   *
   * The scenario appends by position with useColumnHeaders false, so whether
   * this tab has headings depends on whether a person typed them. If nothing
   * recognises, the blueprint's write order is used and that is reported
   * loudly — reading a disposition as a direction would change what somebody
   * is paid without failing.
   */
  const { index: headerIndex, matches } = findHeaderRow(rows, (cell) =>
    RAW_CALL_HEADER_TO_FIELD.has(normaliseRawHeader(cell)),
  );

  const columnOf = new Map<string, number>();
  const unmatched: string[] = [];
  let positional = false;

  if (matches === 0) {
    positional = true;
    RAW_CALL_POSITIONAL_ORDER.forEach((field, index) => {
      if (field !== null && !columnOf.has(field)) columnOf.set(field, index);
    });
    ctx.note('read_by_position_because_no_headings_matched', true);
    ctx.recordError(
      `No row in "${tab}" recognises as a header, so the columns were read by ` +
        "position from the Make scenario's own write order. That is an " +
        'assumption, and this tab decides agent commission: if the scenario is ' +
        'edited to write a different order this will miscount bookings without ' +
        'failing. Add a header row to the tab to remove the guess.',
      { tab },
    );
  } else {
    (rows[headerIndex] ?? []).forEach((header, index) => {
      const key = normaliseRawHeader(header);
      if (key === '') return;
      const field = RAW_CALL_HEADER_TO_FIELD.get(key);
      if (field === undefined) {
        unmatched.push(header.trim());
        return;
      }
      // First occurrence wins. The scenario writes call_time into two columns,
      // so the second is reported rather than silently overwriting the first.
      if (!columnOf.has(field)) columnOf.set(field, index);
    });

    ctx.note('header_row_in_sheet', headerIndex + 1);
    ctx.note('headers_mapped', [...columnOf.keys()].sort());
    if (unmatched.length > 0) ctx.note('headers_unrecognised', unmatched);
  }

  const missingRequired = RAW_CALL_REQUIRED_FIELDS.filter(
    (field) => !columnOf.has(field),
  );
  if (missingRequired.length > 0) {
    ctx.recordError(
      'The RAW DATA tab is missing required column(s): ' +
        `${missingRequired.join(', ')}. Headers present: ` +
        `${(rows[headerIndex] ?? []).join(' | ')}. The agent and the ` +
        'disposition are what the pay formula counts, so importing without ' +
        'them would produce a booking count that looks real and is not.',
      { missing: missingRequired },
    );
    return;
  }

  const dataRows = positional ? rows : rows.slice(headerIndex + 1);

  const cell = (row: string[], field: string): string | undefined => {
    const index = columnOf.get(field);
    return index === undefined ? undefined : row[index];
  };

  const importedAt = new Date().toISOString();
  const records: Record<string, unknown>[] = [];
  let skippedBlank = 0;
  let withoutAgent = 0;
  let withoutDate = 0;
  let booked = 0;
  /*
   * Rows the primary column cannot date but the other column can, and how many
   * of those are bookings. This is the sheet defect, measured rather than
   * papered over: each one is a call the pay formula cannot see.
   */
  let datedOnlyByTheOtherColumn = 0;
  let bookingsLostToBlankDates = 0;
  /*
   * A date after today is impossible for a call that has already happened, and
   * is the signature of a misparsed one. Counted and rejected rather than
   * stored: 70 such rows reached this table once and quietly moved bookings
   * between pay windows.
   */
  let impossibleDates = 0;

  dataRows.forEach((row, offset) => {
    const agent = text(cell(row, 'agent_name'));
    /*
     * The PRIMARY date column only. Deliberately not coalesced.
     *
     * An earlier version of this took whichever of the two call_time columns
     * parsed, on the reasoning that 590 rows arriving with no date — 34 of them
     * bookings — was 34 rows of somebody's commission falling outside every
     * window. That reasoning was wrong twice over.
     *
     * It was wrong on the data: the second column follows a different date
     * convention, so asInstant read day/month as month/day and produced 70
     * rows dated in the FUTURE — 7 October 2026 and 7 February 2027. Those are
     * merely the visible ones. A July call filed as October stands out; an
     * August call filed as May does not, and there is no way to count those
     * without the raw text, which was never stored.
     *
     * And it was wrong on the purpose. This table exists to reconcile with what
     * agents are actually PAID, and the pay formula bounds on the primary
     * column. Before the coalesce, the Hub and the dashboard agreed exactly —
     * Karol Sanchez 54 and 54. The coalesce broke a correct answer to fix a
     * problem that is not in the Hub at all.
     *
     * The blank cells are real and they do cost somebody money. But that is a
     * defect in the sheet, to be reported and fixed there, not guessed at here.
     * The counters below report it; see rows_dated_only_by_the_other_column.
     */
    const calledAt = asInstant(cell(row, 'called_at'));
    const disposition = text(cell(row, 'disposition'));

    // A row with none of the three columns the formula reads is spreadsheet
    // padding, not a call.
    if (agent === null && calledAt === null && disposition === null) {
      skippedBlank += 1;
      return;
    }

    if (agent === null) withoutAgent += 1;
    if (calledAt === null) withoutDate += 1;
    if (disposition !== null && /booked/i.test(disposition)) booked += 1;

    const isBooked = disposition !== null && /booked/i.test(disposition);

    if (calledAt === null && asInstant(cell(row, 'called_at_secondary')) !== null) {
      datedOnlyByTheOtherColumn += 1;
      if (isBooked) bookingsLostToBlankDates += 1;
    }

    /*
     * A call cannot have happened tomorrow. Anything dated ahead of now is a
     * parse failure, so the row still imports but undated — an undated row is
     * visible in the counters, whereas a row dated three months out silently
     * joins or leaves a pay window.
     */
    const impossible = calledAt !== null && calledAt > importedAt;
    if (impossible) impossibleDates += 1;
    const usableAt = impossible ? null : calledAt;

    records.push({
      source_row: (positional ? 1 : headerIndex + 2) + offset,
      called_at: usableAt,
      called_on: usableAt === null ? null : usableAt.slice(0, 10),
      agent_name: agent,
      disposition,
      duration_seconds: asSeconds(cell(row, 'duration_seconds')),
      direction: text(cell(row, 'direction')),
      status: text(cell(row, 'status')),
      lead_source: text(cell(row, 'lead_source')),
      location_name: text(cell(row, 'location_name')),
      lead_crm_id: text(cell(row, 'lead_crm_id')),
      member_crm_id: text(cell(row, 'member_crm_id')),
      group_crm_id: text(cell(row, 'group_crm_id')),
      from_number: text(cell(row, 'from_number')),
      to_number: text(cell(row, 'to_number')),
      country_code: text(cell(row, 'country_code')),
      time_zone: text(cell(row, 'time_zone')),
      stage_entry_date: asDate(cell(row, 'stage_entry_date')),
      lead_created_date: asDate(cell(row, 'lead_created_date')),
      imported_at: importedAt,
    });
  });

  ctx.counts.read = dataRows.length;
  if (skippedBlank > 0) ctx.note('skipped_blank_rows', skippedBlank);
  /*
   * Both reported, because both silently reduce somebody's pay. A row with no
   * agent is a booking credited to nobody; a row with no date falls outside
   * every window the dashboard offers, including the one commission is paid on.
   */
  if (withoutAgent > 0) ctx.note('rows_naming_no_agent', withoutAgent);
  if (withoutDate > 0) ctx.note('rows_with_no_readable_date', withoutDate);
  ctx.note('rows_matching_booked', booked);
  if (datedOnlyByTheOtherColumn > 0) {
    ctx.note('rows_dated_only_by_the_other_column', datedOnlyByTheOtherColumn);
    /*
     * Raised as an error, not a note, when bookings are involved. Each one is a
     * booking the pay formula cannot see because a cell in the sheet is blank,
     * and it will stay invisible until somebody fills that column in.
     */
    if (bookingsLostToBlankDates > 0) {
      ctx.recordError(
        `${bookingsLostToBlankDates} booking(s) sit in rows whose primary date ` +
          'cell is blank, so the pay dashboard cannot count them and the agent ' +
          'is not paid for them. The other call_time column does hold a date ' +
          'for those rows, but it follows a different convention and parsing it ' +
          'produced dates in the future, so it is not trusted here. Fix is in ' +
          'the sheet: fill the primary date column.',
        { bookings: bookingsLostToBlankDates, rows: datedOnlyByTheOtherColumn },
      );
    }
  }
  if (impossibleDates > 0) {
    ctx.recordError(
      `${impossibleDates} row(s) carried a date later than now and were ` +
        'imported undated rather than stored. A call cannot happen in the ' +
        'future, so this is a parse failure — and a row dated months ahead ' +
        'silently joins and leaves pay windows, which is worse than a row with ' +
        'no date at all.',
      { rows: impossibleDates },
    );
  }

  for (let start = 0; start < records.length; start += BATCH) {
    const batch = records.slice(start, start + BATCH);
    const written = await db
      .from('raw_call_rows')
      .upsert(batch as never, { onConflict: 'source_row' });

    if (written.error) {
      ctx.recordError(
        `Writing rows ${start + 1}-${start + batch.length} failed: ` +
          written.error.message,
        { from: start + 1, count: batch.length },
      );
      return;
    }

    ctx.counts.updated += batch.length;
  }

  /*
   * Attach to the roster and to a practice. Fills nulls only, so a correction
   * made by hand survives the next import.
   */
  const attached = await db.rpc('resolve_raw_call_attribution');

  if (attached.error) {
    ctx.recordError(
      'RAW DATA rows were imported but could not be attached: ' +
        `${attached.error.message}. Until this succeeds the bookings are ` +
        'grouped by the name on the sheet rather than by person, so nothing ' +
        'that joins on the roster can pay anybody.',
    );
  } else {
    ctx.note('rows_attached', attached.data ?? 0);
  }

  /*
   * The figure that says whether pay can be trusted. Non-zero means bookings
   * exist that the Hub cannot credit to anybody on the roster.
   */
  const orphaned = await db
    .from('raw_call_rows')
    .select('id', { count: 'exact', head: true })
    .is('agent_id', null);

  if (!orphaned.error) {
    ctx.note('rows_credited_to_nobody', orphaned.count ?? 0);
  }

  ctx.note('rows_imported', records.length);
}
