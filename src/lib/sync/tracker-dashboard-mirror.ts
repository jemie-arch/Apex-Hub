/**
 * Copy the tracker workbook's computed tabs into cft_sheet_mirror.
 *
 * The Client Fulfilment Tracker sheet has two kinds of tab. The raw tabs
 * (Leads Data, Appointment Data, Ads Data, Call Data) are what the Hub's other
 * syncs import. The computed tabs - STATS DASHBOARD and the three Client
 * Results tabs - are the formulas Joshua reads, and they are the only
 * reference for "is the Hub's figure right". This sync copies them, cell for
 * cell, so the comparison can be a SQL query that names the practice, the
 * column and the difference, instead of two screenshots held side by side.
 *
 * Raw and formatted, deliberately. FORMATTED_VALUE means a cell that reads
 * "US$1,222" on screen arrives as that string; the query that compares it
 * strips the formatting, and a reader of the mirror sees what the sheet
 * showed. Nothing is interpreted here, so nothing here can be wrong in an
 * interesting way - if the mirror disagrees with the sheet, the sheet changed.
 *
 * Whole tab, replaced each run. The tabs are a few hundred rows; a diff of
 * what changed is a query over imported_at, not this sync's job.
 */
import { readSheet, listSheetTitles } from '@/lib/integrations/google-sheets';
import { serverEnv } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

import type { SyncContext } from './runner';

/** The computed tabs, by the titles the workbook uses. */
const TABS = [
  'STATS DASHBOARD',
  'Client Results - Campaign',
  'Client Results - Ad Set',
  'Client Results - Ads',
] as const;

/** Wide enough for every tab; Google trims trailing empties anyway. */
const RANGE_SUFFIX = '!A1:BZ3000';

const BATCH = 400;

export async function syncTrackerDashboardMirror(ctx: SyncContext): Promise<void> {
  const db = serviceClient();
  const sheetId = serverEnv().FULFILMENT_TRACKER_SHEET_ID;
  if (!sheetId) {
    ctx.recordError(
      'FULFILMENT_TRACKER_SHEET_ID is not set, so the tracker workbook cannot be read.',
    );
    return;
  }

  const titles = await listSheetTitles(sheetId);
  ctx.note('tabs_in_workbook', titles);

  for (const tab of TABS) {
    if (!titles.includes(tab)) {
      ctx.recordError(`Tab "${tab}" is not in the workbook; skipped.`, { tabs: titles });
      continue;
    }

    const rows = await readSheet(sheetId, `'${tab}'${RANGE_SUFFIX}`);
    ctx.counts.read += rows.length;

    // Header rows, so the comparison query can name columns without a guess.
    ctx.note(`${tab}: first rows`, rows.slice(0, 6));
    ctx.note(`${tab}: rows`, rows.length);
    ctx.note(`${tab}: widest row`, rows.reduce((max, row) => Math.max(max, row.length), 0));

    const removed = await db.from('cft_sheet_mirror').delete().eq('tab', tab);
    if (removed.error) throw removed.error;

    for (let start = 0; start < rows.length; start += BATCH) {
      const batch = rows.slice(start, start + BATCH).map((cells, offset) => ({
        tab,
        row_number: start + offset + 1,
        cells,
      }));
      const inserted = await db.from('cft_sheet_mirror').insert(batch);
      if (inserted.error) throw inserted.error;
      ctx.counts.created += batch.length;
    }
  }

  ctx.log(`mirrored ${ctx.counts.created} row(s) across ${TABS.length} tab(s)`);
}
