/**
 * Import the tracker's leads tab into tracker_leads.
 *
 * The gap this closes: tracker_leads was loaded once, on 22 August 2026, and
 * no sync has ever written it. The Client Fulfilment Tracker reads it as
 * leads_tracker and takes leads_best = greatest(leads_windsor, leads_tracker);
 * Windsor reports nothing for 30 of 35 accounts, so when the sheet went stale
 * the lead count collapsed and CPL went with it — $8,844 per lead for the week
 * of 31 August, against $35 three weeks earlier. See config/fulfilment-leads
 * for the figures.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not write to the sheet: scope is spreadsheets.readonly.
 *
 * It does not delete. A row that disappears from the sheet stays in the
 * database, because the likeliest reasons for a row vanishing are a filter
 * somebody left on and a range that moved, and neither is a reason to destroy
 * a lead record that a cost-per-lead figure depends on.
 *
 * It does not match practices to clients here. tracker_practice_aliases owns
 * that, data-driven since 0025, and a second copy of the rule is how two
 * answers to the same question start to diverge. client_id is left null and
 * resolved the same way the appointments import resolves it.
 *
 * It does not assume the tab name. Nobody has said which of the workbook's
 * seventeen tabs holds the leads, so it finds a candidate, says which one it
 * chose, and lists every tab it saw — because guessing a name is what cost the
 * appointments import its first two runs.
 */
import {
  LEADS_TAB_CANDIDATES,
  LEAD_HEADER_TO_FIELD,
  LEAD_REQUIRED_FIELDS,
  looksLikeLeadsTab,
  normaliseLeadHeader,
} from '@/config/fulfilment-leads';
import { serverEnv } from '@/lib/env';
import { listSheetTitles, readSheet } from '@/lib/integrations/google-sheets';
import { findHeaderRow } from '@/lib/sheet-headers';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

const BATCH = 200;

function text(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A date as the sheet displays it. Same rules as the appointments import:
 * strict, and null rather than a guess.
 *
 * received_on is what puts a lead in a reporting window, so a date invented
 * from an ambiguous string would move a lead between weeks and change a CPL
 * nobody could then explain.
 */
function asDate(value: string | undefined): string | null {
  const raw = text(value);
  if (raw === null) return null;

  const slashed = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashed) {
    const [, month, day, year] = slashed;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/**
 * The sheet's count column, defaulting to one.
 *
 * A blank means one lead, which is what the view already assumes with
 * coalesce(lead_count, 1) — so reading it as null here and 1 there would make
 * the same row count differently depending on who asked. Zero is kept as zero:
 * somebody typing 0 is making a statement.
 */
function asCount(value: string | undefined): number {
  const raw = text(value);
  if (raw === null) return 1;
  const digits = raw.replace(/[^0-9-]/g, '');
  if (digits === '' || digits === '-') return 1;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

export async function syncFulfilmentLeads(ctx: SyncContext): Promise<void> {
  const db = serviceClient();
  const sheetId = serverEnv().FULFILMENT_TRACKER_SHEET_ID;

  if (!sheetId) {
    ctx.recordError(
      'FULFILMENT_TRACKER_SHEET_ID is not set, so the leads tab cannot be ' +
        "read. It is the id in the tracker's own URL, between /d/ and /edit.",
    );
    return;
  }

  /*
   * Find the tab before reading it.
   *
   * Asking for a range on a tab that does not exist returns a 400 naming
   * nothing useful, so the tab list comes first and is reported either way.
   * That report is the point of the first run: if the pick is wrong, the right
   * name is sitting in the note beside it.
   */
  let tabs: string[];
  try {
    tabs = await listSheetTitles(sheetId);
  } catch (error) {
    ctx.recordError(
      'Could not list the tracker tabs, so the leads tab cannot be found: ' +
        `${error instanceof Error ? error.message.slice(0, 300) : 'unknown'}`,
    );
    return;
  }

  ctx.note('tabs_in_workbook', tabs);

  // A named candidate wins over a loose match, so a deliberate choice beats a
  // coincidence — "Lead Data" is picked ahead of "Leads Archive 2024".
  const named = LEADS_TAB_CANDIDATES.find((candidate) =>
    tabs.some((tab) => tab.trim().toLowerCase() === candidate.toLowerCase()),
  );
  const tab =
    (named && tabs.find((t) => t.trim().toLowerCase() === named.toLowerCase())) ??
    tabs.find(looksLikeLeadsTab);

  if (!tab) {
    ctx.recordError(
      'No tab in the tracker looks like a leads tab. Tabs present: ' +
        `${tabs.join(' | ')}. Add the real name to LEADS_TAB_CANDIDATES in ` +
        'config/fulfilment-leads rather than renaming the sheet.',
      { tabs },
    );
    return;
  }

  ctx.note('leads_tab_chosen', tab);
  ctx.note('leads_tab_matched_by', named ? 'exact name' : 'contains "lead"');

  const range = `${tab}!A:Z`;

  let rows: string[][];
  try {
    rows = await readSheet(sheetId, range);
  } catch (error) {
    ctx.recordError(
      `Could not read ${range}: ` +
        `${error instanceof Error ? error.message.slice(0, 300) : 'unknown'}`,
      { tabs },
    );
    return;
  }

  if (rows.length < 2) {
    ctx.recordError(
      `${range} returned ${rows.length} row(s), so there is nothing to import.`,
      { tabs },
    );
    return;
  }

  // Not row 1. The appointments tab opens with a merged banner and puts its
  // headings on row 4; this workbook is built the same way throughout.
  const { index: headerIndex, sheetRow } = findHeaderRow(rows, (cell) =>
    LEAD_HEADER_TO_FIELD.has(normaliseLeadHeader(cell)),
  );

  const headerRow = rows[headerIndex] ?? [];
  const dataRows = rows.slice(headerIndex + 1);

  ctx.note('header_row_in_sheet', sheetRow);

  const columnOf = new Map<string, number>();
  const unmatched: string[] = [];

  headerRow.forEach((header, index) => {
    const key = normaliseLeadHeader(header);
    if (key === '') return;
    const field = LEAD_HEADER_TO_FIELD.get(key);
    if (field === undefined) {
      unmatched.push(header.trim());
      return;
    }
    if (!columnOf.has(field)) columnOf.set(field, index);
  });

  ctx.note('headers_seen', headerRow.length);
  ctx.note('headers_mapped', [...columnOf.keys()].sort());
  if (unmatched.length > 0) ctx.note('headers_unrecognised', unmatched);

  const missingRequired = LEAD_REQUIRED_FIELDS.filter(
    (field) => !columnOf.has(field),
  );
  if (missingRequired.length > 0) {
    /*
     * Stop rather than import a partial picture. A lead with no practice
     * belongs to nobody and a lead with no date lands in no window, so either
     * absence makes every row unusable — and writing a thousand unusable rows
     * over a snapshot that at least made sense is worse than not running.
     */
    ctx.recordError(
      `The leads tab "${tab}" is missing required column(s): ` +
        `${missingRequired.join(', ')}. Headers actually present: ` +
        `${headerRow.join(' | ')}. Add the spelling to LEAD_COLUMNS in ` +
        'config/fulfilment-leads rather than renaming the sheet, so the ' +
        'tracker stays whatever its users expect.',
      { missing: missingRequired, tab },
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
    const company = text(cell(row, 'company_name'));
    const receivedOn = asDate(cell(row, 'received_on'));

    if (company === null || receivedOn === null) {
      skippedIncomplete += 1;
      return;
    }

    records.push({
      // The sheet's own row number, counted from the header wherever it turned
      // out to be. It is the upsert key, so an offset here makes a re-run
      // write a second copy of every row instead of updating the first.
      source_row: headerIndex + 2 + offset,
      company_name: company,
      received_on: receivedOn,
      lead_name: text(cell(row, 'lead_name')),
      lead_count: asCount(cell(row, 'lead_count')),
      campaign_external_id: text(cell(row, 'campaign_external_id')),
      campaign_name: text(cell(row, 'campaign_name')),
      adset_external_id: text(cell(row, 'adset_external_id')),
      adset_name: text(cell(row, 'adset_name')),
      ad_external_id: text(cell(row, 'ad_external_id')),
      ad_name: text(cell(row, 'ad_name')),
      imported_at: importedAt,
    });
  });

  ctx.counts.read = dataRows.length;
  if (skippedIncomplete > 0) {
    ctx.note('skipped_without_company_or_date', skippedIncomplete);
  }

  for (let start = 0; start < records.length; start += BATCH) {
    const batch = records.slice(start, start + BATCH);
    const written = await db
      .from('tracker_leads')
      .upsert(batch as never, { onConflict: 'source_row' });

    if (written.error) {
      ctx.recordError(
        `Could not write lead rows ${start + 2}–${start + batch.length + 1}: ` +
          written.error.message,
        { from: start + 2, count: batch.length },
      );
      return;
    }
    ctx.counts.updated += batch.length;
  }

  /*
   * The total is worth logging next to the row count, because the two differ:
   * a row can stand for several leads, and it is the sum that divides into
   * spend to make CPL.
   */
  /*
   * Notes, not ctx.log. Two runs sent these to console.log, which sync_runs
   * never sees — so the one figure asked for each time was the one figure that
   * could not be read.
   *
   * Both are reported because they differ: a row can stand for several leads,
   * and it is the SUM that divides into spend to make CPL.
   */
  const leads = records.reduce(
    (total, row) => total + (row['lead_count'] as number),
    0,
  );

  ctx.note('lead_rows_imported', records.length);
  ctx.note('leads_in_total', leads);
  ctx.note(
    'rows_standing_for_more_than_one_lead',
    records.filter((row) => (row['lead_count'] as number) !== 1).length,
  );
}
