/**
 * The AI call-summary sheet that Make already writes.
 *
 * Make scenario 5560467, "Call Center Dashboard HP->SheetsAI->Transcript",
 * transcribes each recording with AssemblyAI, has GPT label the speakers,
 * summarise the call and grade it as a sales audit, and appends a row here. It
 * ran on 28 August 2026, worked, then stopped on Make's organisation
 * dead-letter-queue limit and was switched off.
 *
 * Nothing has ever read the output. This config is the Hub reading it.
 *
 * WHAT THE SCENARIO WRITES, from its own blueprint
 *
 * Twelve values, in this order, appended to the CALL SUMMARIES tab:
 *
 *   0  call_time         when the call happened
 *   1  caller_name       THE AGENT — see below
 *   2  lead_Name         the patient
 *   3  leadId            GoHighLevel contact id
 *   4  to_number         the number dialled
 *   5  GPT               transcript, speaker-labelled "Agent:" / "Lead:"
 *   6  audio_duration    from AssemblyAI
 *   7  audio_url         the recording
 *   8  GPT               summary, as bullet points
 *   9  GPT               coaching, written from a sales-audit grading
 *   10 GPT               the same value as 9 — written twice by the scenario
 *   11 GPT               a further completion
 *
 * caller_name is why this matters beyond the transcript. GoHighLevel stamps a
 * user on 171 of 7,142 calls, 2.4%, because inbound forwards off-platform — so
 * per-agent call efficiency has been impossible. This names an agent on every
 * row.
 *
 * COLUMN ORDER IS NOT ASSUMED
 *
 * The blueprint writes by position with `useColumnHeaders: false`, so the tab's
 * headings are whatever a person typed above those columns and may not match
 * the field names at all. Headings are therefore matched by spelling, the same
 * way as every other sheet here, and the first run reports every heading it
 * could not place. Guessing a column is what cost the appointments import two
 * runs and the booking sheet two more.
 */

/**
 * The spreadsheet, from the scenario's own blueprint.
 *
 * Not an env var, and not a secret: a spreadsheet id is an identifier, and
 * access is controlled by whether the sheet is shared with the service account.
 * Hardcoded so this needs no new configuration to work — overridable by
 * CALL_SUMMARIES_SHEET_ID if the sheet is ever replaced.
 */
export const CALL_SUMMARIES_SHEET_ID =
  '1NyLCtIiXYIO6VzfTqhZ98F62CZ_s6rblbWzECqyY7p8';

/** Tabs on that spreadsheet, from the blueprint: CALL SUMMARIES, RAW DATA, GHL Directory. */
export const CALL_SUMMARIES_TAB_CANDIDATES: readonly string[] = [
  'CALL SUMMARIES',
  'Call Summaries',
  'CALL SUMMARY',
];

/** A tab that looks like the summaries tab, if none of the above matches. */
export function looksLikeSummariesTab(title: string): boolean {
  const lower = title.trim().toLowerCase();
  // RAW DATA is the untranscribed feed and GHL Directory is a lookup; neither
  // is one row per summarised call.
  if (lower.includes('raw')) return false;
  if (lower.includes('directory')) return false;
  return lower.includes('summar');
}

export interface SummaryColumn {
  field: string;
  headers: readonly string[];
  required?: boolean;
}

export const SUMMARY_COLUMNS: readonly SummaryColumn[] = [
  {
    field: 'called_at',
    headers: [
      'call time',
      'call_time',
      'called at',
      'date',
      'timestamp',
      'call date',
      'date and time',
    ],
    required: true,
  },
  {
    /*
     * The agent. Required, because a row without one is a call attributed to
     * nobody — and attribution is the reason this import exists at all.
     */
    field: 'agent_name',
    headers: [
      'caller name',
      'caller_name',
      'caller',
      'agent',
      'agent name',
      'isr',
      'rep',
      'user',
    ],
    required: true,
  },
  {
    field: 'lead_name',
    headers: ['lead name', 'lead_name', 'lead', 'patient', 'patient name', 'contact'],
  },
  {
    field: 'lead_crm_id',
    headers: ['leadid', 'lead id', 'contact id', 'contactid', 'crm id', 'ghl id'],
  },
  {
    field: 'to_number',
    headers: ['to number', 'to_number', 'number', 'phone', 'to', 'dialled', 'dialed'],
  },
  {
    field: 'transcript',
    headers: ['transcript', 'call transcript', 'formatted transcript', 'conversation'],
  },
  {
    field: 'duration_seconds',
    headers: [
      'audio duration',
      'audio_duration',
      'duration',
      'call duration',
      'length',
      'talk time',
    ],
  },
  {
    field: 'recording_url',
    headers: ['audio url', 'audio_url', 'recording', 'recording url', 'audio'],
  },
  {
    field: 'summary',
    headers: ['summary', 'call summary', 'bullet points', 'key points', 'notes'],
  },
  {
    /*
     * The sales coach. The scenario writes this value into two adjacent
     * columns, so whichever heading is matched first wins and the duplicate is
     * reported as unrecognised — which is honest: two columns holding one
     * value is a fact about the sheet, not something to hide.
     */
    field: 'coaching',
    headers: [
      'coaching',
      'coach',
      'sales coaching',
      'feedback',
      'audit',
      'grading',
      'sales audit',
    ],
  },
];

/** Normalised for comparison: case, surrounding space and inner runs of space. */
export function normaliseSummaryHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Header text to field, built once.
 *
 * Throws at module load on a spelling claimed by two fields, which would make
 * the mapping depend on declaration order.
 */
export const SUMMARY_HEADER_TO_FIELD: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const column of SUMMARY_COLUMNS) {
    for (const header of column.headers) {
      const key = normaliseSummaryHeader(header);
      const existing = map.get(key);
      if (existing && existing !== column.field) {
        throw new Error(
          `Call-summary header "${header}" is claimed by both ${existing} and ` +
            `${column.field}. One spelling cannot mean two columns.`,
        );
      }
      map.set(key, column.field);
    }
  }
  return map;
})();

export const SUMMARY_REQUIRED_FIELDS: readonly string[] = SUMMARY_COLUMNS.filter(
  (column) => column.required,
).map((column) => column.field);

/**
 * Positional fallback, used only when the tab has no usable header row.
 *
 * The scenario writes by position with useColumnHeaders false, so a tab whose
 * top row is data — or whose headings nobody ever typed — is a real
 * possibility. In that case the order above is the order the blueprint writes,
 * and reading by position is better than importing nothing.
 *
 * Reported loudly when used, because it is an assumption rather than a match:
 * if the scenario is ever edited to write a different order, this silently
 * files a summary as a transcript.
 */
export const SUMMARY_POSITIONAL_ORDER: readonly (string | null)[] = [
  'called_at',
  'agent_name',
  'lead_name',
  'lead_crm_id',
  'to_number',
  'transcript',
  'duration_seconds',
  'recording_url',
  'summary',
  'coaching',
  null, // column 10: the scenario writes coaching twice
  null, // column 11: a further completion, unmapped until somebody names it
];
