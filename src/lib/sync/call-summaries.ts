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
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/** Smaller than the other sheet imports: each row carries a whole transcript. */
const BATCH = 50;

/**
 * How much transcript text to keep per call.
 *
 * A long consultation transcribes to tens of thousands of characters, and the
 * point of storing it is for a person to read the call — not to hold an
 * unbounded blob in a row that several pages select. Truncated with a marker
 * so nobody mistakes a clipped transcript for a short call.
 */
const MAX_TEXT = 20_000;

function text(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_TEXT
    ? `${trimmed.slice(0, MAX_TEXT)}\n\n[truncated by the Hub at ${MAX_TEXT} characters]`
    : trimmed;
}

/**
 * The call's timestamp, however the sheet spells it.
 *
 * Deliberately permissive here, unlike the tracker's date parsing: this column
 * is written by an automation rather than typed, so it is an ISO instant or a
 * locale string rather than an ambiguous D/M vs M/D. Anything unreadable
 * becomes null rather than a guess, and the row still imports — a transcript
 * with no timestamp is still worth having, it just cannot appear in a daily
 * count.
 */
function asInstant(value: string | undefined): string | null {
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

/**
 * A duration in seconds, from whatever the sheet holds.
 *
 * AssemblyAI reports seconds as a number, but the column has also been seen
 * rendered as "3:47". Both are read; anything else is null rather than zero,
 * because a call of unknown length and a call of no length are different and
 * the average in v_call_summary_agent_daily excludes only the second.
 */
function asSeconds(value: string | undefined): number | null {
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
   * Matched on name, because the sheet carries a name and not an id. Resolved
   * here rather than in SQL so the match rule sits beside the import that
   * needs it, and reported either way: an unattached call is missing from that
   * person's figures and invisible in the figures it is missing from.
   */
  const staff = await db
    .from('user_profiles')
    .select('id, full_name, email')
    .eq('is_active', true);

  if (staff.error) throw staff.error;

  const byName = new Map<string, string>();
  for (const person of staff.data ?? []) {
    const name = person.full_name?.trim().toLowerCase();
    if (name) byName.set(name, person.id);
  }

  let attached = 0;
  for (const record of records) {
    const agent = (record['agent_name'] as string | null)?.trim().toLowerCase();
    if (!agent) continue;
    const id = byName.get(agent);
    if (!id) continue;

    const set = await db
      .from('call_summaries')
      .update({ agent_user_id: id } as never)
      .eq('source_row', record['source_row'] as number)
      .is('agent_user_id', null);

    if (!set.error) attached += 1;
  }

  ctx.note('calls_attached_to_a_person', attached);

  const unattached = await db
    .from('call_summaries')
    .select('id', { count: 'exact', head: true })
    .is('agent_user_id', null);

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
