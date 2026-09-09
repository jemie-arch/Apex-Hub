/**
 * Import the AI call summaries Make already produces.
 *
 * Make scenario 5560467 transcribes each recording with AssemblyAI, has GPT
 * label the speakers, summarise the call and grade it as a sales audit, and
 * appends a row to a Google Sheet. It worked on 28 August 2026 and was then
 * switched off after filling Make's organisation dead-letter queue.
 *
 * Nothing has ever read that sheet. This does.
 *
 * WHY IT MATTERS BEYOND THE TRANSCRIPT
 *
 * Column B is caller_name — the agent, on every row. GoHighLevel stamps a user
 * on 171 of 7,142 calls, 2.4%, because inbound forwards off-platform, so
 * per-agent call efficiency has been impossible. This is the attribution that
 * was missing, and it has been sitting in a spreadsheet.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not write to the sheet, and it does not write to Make. Scope is
 * spreadsheets.readonly.
 *
 * It does not transcribe anything. All the AI work already happened; this
 * reads the result. Nothing here calls OpenAI or AssemblyAI, so importing
 * costs nothing per call.
 *
 * It does not delete. A row removed from the sheet stays here — a transcript
 * is a record of a conversation that did happen.
 */
import {
  CALL_SUMMARIES_SHEET_ID,
  CALL_SUMMARIES_TAB_CANDIDATES,
  SUMMARY_HEADER_TO_FIELD,
  SUMMARY_POSITIONAL_ORDER,
  SUMMARY_REQUIRED_FIELDS,
  looksLikeSummariesTab,
  normaliseSummaryHeader,
} from '@/config/call-summaries';
import { serverEnv } from '@/lib/env';
import { listSheetTitles, readSheet } from '@/lib/integrations/google-sheets';
import { findHeaderRow } from '@/lib/sheet-headers';
import { asInstant, asSeconds, text } from '@/lib/sheet-values';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/** Smaller than the other sheet imports: each row carries a whole transcript. */
const BATCH = 50;

/*
 * text, asInstant and asSeconds now live in @/lib/sheet-values, because the
 * RAW DATA importer needs exactly the same coercion — same workbook, same Make
 * scenario writing it, so the same shapes arrive in both. Two copies would
 * eventually disagree about what "3:47" means, and one of the things that
 * decides is what an agent gets paid.
 */

/**
 * The audit's 1-10 score, as a number.
 *
 * Written by a language model, so it arrives as "8", "8/10", "8.5" or a
 * sentence. Anything outside 0-10 is discarded rather than clamped: a value of
 * 85 is a model that misunderstood the scale, and clamping it to 10 would put
 * a fabricated perfect score into an agent's average.
 */
function asGrading(value: string | undefined): number | null {
  const raw = text(value);
  if (raw === null) return null;

  const found = raw.match(/(\d{1,3}(?:\.\d+)?)/);
  if (!found) return null;

  const parsed = Number(found[1]);
  if (!Number.isFinite(parsed)) return null;
  return parsed >= 0 && parsed <= 10 ? parsed : null;
}

export async function syncCallSummaries(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  /*
   * The scenario's own spreadsheet, overridable but not required. A
   * spreadsheet id is an identifier rather than a secret — access is decided
   * by whether the sheet is shared with the service account — so hardcoding
   * the default means this needs no new configuration to run.
   */
  const sheetId =
    serverEnv().CALL_SUMMARIES_SHEET_ID ?? CALL_SUMMARIES_SHEET_ID;

  let tabs: string[];
  try {
    tabs = await listSheetTitles(sheetId);
  } catch (error) {
    ctx.recordError(
      'Could not open the AI call-summary spreadsheet. It is the sheet Make ' +
        'scenario 5560467 writes, and it has to be shared as a Viewer with ' +
        `the Hub's service account. Detail: ${
          error instanceof Error ? error.message.slice(0, 300) : 'unknown'
        }`,
    );
    return;
  }

  ctx.note('tabs_in_workbook', tabs);

  const named = CALL_SUMMARIES_TAB_CANDIDATES.find((candidate) =>
    tabs.some((tab) => tab.trim().toLowerCase() === candidate.toLowerCase()),
  );
  const tab =
    (named && tabs.find((t) => t.trim().toLowerCase() === named.toLowerCase())) ??
    tabs.find(looksLikeSummariesTab);

  if (!tab) {
    ctx.recordError(
      'No tab looks like the call summaries. Tabs present: ' +
        `${tabs.join(' | ')}. The Make scenario writes to "CALL SUMMARIES"; ` +
        'add the real name to CALL_SUMMARIES_TAB_CANDIDATES rather than ' +
        'renaming the sheet.',
      { tabs },
    );
    return;
  }

  ctx.note('summaries_tab_chosen', tab);

  let rows: string[][];
  try {
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
    /*
     * An empty tab is the expected state right now and is reported as a
     * problem anyway, because it has one cause worth acting on: the scenario
     * is switched off. It ran on 28 August, filled Make's dead-letter queue,
     * and stopped. Nothing will appear here until that queue is cleared and
     * the scenario is turned back on.
     */
    ctx.recordError(
      `The "${tab}" tab is empty. Make scenario 5560467 is the only thing ` +
        'that writes it, and it is currently inactive — it stopped on 28 ' +
        'August 2026 having filled the organisation dead-letter queue. Clear ' +
        'the queue and re-enable it, and this fills from the next call.',
      { tab },
    );
    return;
  }

  /*
   * Find the header row, and cope with there being none.
   *
   * The scenario appends by position with useColumnHeaders false, so whether
   * the tab has headings at all depends on whether a person typed them. If
   * nothing in the first rows recognises as a heading, the blueprint's own
   * write order is used instead — and that fallback is reported loudly,
   * because it is an assumption rather than a match.
   */
  const { index: headerIndex, matches } = findHeaderRow(rows, (cell) =>
    SUMMARY_HEADER_TO_FIELD.has(normaliseSummaryHeader(cell)),
  );

  const columnOf = new Map<string, number>();
  const unmatched: string[] = [];
  let positional = false;

  if (matches === 0) {
    positional = true;
    SUMMARY_POSITIONAL_ORDER.forEach((field, index) => {
      if (field !== null && !columnOf.has(field)) columnOf.set(field, index);
    });
    ctx.note('read_by_position_because_no_headings_matched', true);
    ctx.recordError(
      `No row in "${tab}" recognises as a header, so the columns were read by ` +
        "position from the Make scenario's own write order. That is an " +
        'assumption: if the scenario is edited to write a different order, ' +
        'this will file a summary as a transcript without failing. Add a ' +
        'header row to the tab to remove the guess.',
      { tab },
    );
  } else {
    (rows[headerIndex] ?? []).forEach((header, index) => {
      const key = normaliseSummaryHeader(header);
      if (key === '') return;
      const field = SUMMARY_HEADER_TO_FIELD.get(key);
      if (field === undefined) {
        unmatched.push(header.trim());
        return;
      }
      // First occurrence wins. The scenario writes its coaching value into two
      // adjacent columns, so the second is reported rather than silently
      // overwriting the first.
      if (!columnOf.has(field)) columnOf.set(field, index);
    });

    ctx.note('header_row_in_sheet', headerIndex + 1);
    ctx.note('headers_mapped', [...columnOf.keys()].sort());
    if (unmatched.length > 0) ctx.note('headers_unrecognised', unmatched);
  }

  const missingRequired = SUMMARY_REQUIRED_FIELDS.filter(
    (field) => !columnOf.has(field),
  );
  if (missingRequired.length > 0) {
    ctx.recordError(
      `The call-summary tab is missing required column(s): ` +
        `${missingRequired.join(', ')}. Headers present: ` +
        `${(rows[headerIndex] ?? []).join(' | ')}. Without a caller name a ` +
        'call is attributed to nobody, which is the reason this import exists.',
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

  dataRows.forEach((row, offset) => {
    const agent = text(cell(row, 'agent_name'));
    const calledAt = asInstant(cell(row, 'called_at'));
    const transcript = text(cell(row, 'transcript'));
    const summary = text(cell(row, 'summary'));

    // A row with none of these is spreadsheet padding, not a call.
    if (agent === null && calledAt === null && transcript === null && summary === null) {
      skippedBlank += 1;
      return;
    }

    if (agent === null) withoutAgent += 1;

    records.push({
      source_row: (positional ? 1 : headerIndex + 2) + offset,
      called_at: calledAt,
      called_on: calledAt === null ? null : calledAt.slice(0, 10),
      agent_name: agent,
      lead_name: text(cell(row, 'lead_name')),
      lead_crm_id: text(cell(row, 'lead_crm_id')),
      to_number: text(cell(row, 'to_number')),
      duration_seconds: asSeconds(cell(row, 'duration_seconds')),
      recording_url: text(cell(row, 'recording_url')),
      transcript,
      summary,
      coaching: text(cell(row, 'coaching')),
      grading: asGrading(cell(row, 'grading')),
      process_followed: text(cell(row, 'process_followed')),
      imported_at: importedAt,
    });
  });

  ctx.counts.read = dataRows.length;
  if (skippedBlank > 0) ctx.note('skipped_blank_rows', skippedBlank);
  if (withoutAgent > 0) ctx.note('rows_naming_no_agent', withoutAgent);

  for (let start = 0; start < records.length; start += BATCH) {
    const batch = records.slice(start, start + BATCH);
    const written = await db
      .from('call_summaries')
      .upsert(batch as never, { onConflict: 'source_row' });

    if (written.error) {
      ctx.recordError(
        `Could not write call summaries ${start + 1}–${start + batch.length}: ` +
          written.error.message,
        { from: start + 1, count: batch.length },
      );
      return;
    }
    ctx.counts.updated += batch.length;
  }

  /*
   * Attach each call to a person, which is the whole point.
   *
   * Done in SQL by resolve_call_summary_agents rather than by a loop here,
   * because the loop this replaced got three things wrong. It compared
   * full_name to agent_name with case folding alone, so the "Joshua Jung" on
   * the sheet never met the profile spelled "Joshua" — 9 calls that had a
   * profile all along. It had nowhere to record that those two are the same
   * person, so the answer could not be kept once somebody worked it out. And
   * it issued one UPDATE per row: 215 round-trips to attach nothing.
   *
   * The function tries confirmed aliases first, then an exact match on
   * normalised names, and refuses to match at all when two profiles normalise
   * to the same name — crediting one agent with another's calls is worse than
   * leaving the row unattributed, and an unattributed row is already badged in
   * the scoreboard. It fills nulls only, so a correction made by hand outlives
   * the next import.
   */
  const attached = await db.rpc('resolve_call_summary_agents');

  if (attached.error) {
    ctx.recordError(
      'Summaries were imported but could not be attached to people: ' +
        `${attached.error.message}. Until this succeeds every per-agent figure ` +
        'is grouped by the name on the sheet rather than by the person, so ' +
        'nothing that joins on a profile sees the call centre at all.',
    );
  } else {
    ctx.note('calls_attached_to_a_person', attached.data ?? 0);
  }

  /*
   * Counted on agent_id, not agent_user_id.
   *
   * It used to count agent_user_id, and once the roster arrived that made the
   * note permanently alarming for no reason: it reported 206 of 215 "attached
   * to nobody" when every one of them was attributed to a named agent who
   * simply has no Hub login. Not having a login is normal for the call centre.
   * The question worth asking is whether a call reached an agent at all.
   */
  const unattached = await db
    .from('call_summaries')
    .select('id', { count: 'exact', head: true })
    .is('agent_id', null);

  if (!unattached.error) {
    ctx.note('calls_attached_to_nobody', unattached.count ?? 0);
  }

  ctx.note('summaries_imported', records.length);
  ctx.note('with_transcript', records.filter((r) => r['transcript'] !== null).length);
  ctx.note('with_coaching', records.filter((r) => r['coaching'] !== null).length);
  ctx.note('with_grading', records.filter((r) => r['grading'] !== null).length);
  /*
   * Reported because it is the figure that says whether the agents are in the
   * Hub at all. The first import attached 0 of 215 calls — not a name-spelling
   * problem: the call centre has no user_profiles rows, so there was nothing to
   * match against. The scoreboard groups by name when that happens, so the
   * figures still work; this number is how anybody knows why the rows say
   * "no profile".
   */
  ctx.note(
    'agents_named_in_the_sheet',
    [...new Set(records.map((r) => r['agent_name']).filter(Boolean))].length,
  );
}
