/**
 * The AI call-summary sheet that Make already writes.
 *
 * Make scenario 5560467, "Call Center Dashboard HP->SheetsAI->Transcript",
 * transcribes each recording with AssemblyAI, has GPT label the speakers,
 * summarise the call and grade it as a sales audit, and appends a row here.
 *
 * Nothing has ever read the output. This config is the Hub reading it.
 *
 * THE CHAIN THAT WRITES THIS TAB IS ORPHANED. Read this before trusting the
 * tab to grow.
 *
 * That blueprint holds two pipelines, and only one of them is connected to the
 * webhook:
 *
 *   CONNECTED    webhook -> a 22-column row on the RAW DATA tab -> download the
 *                recording -> openai-gpt-3:CreateTranscription -> PUT
 *                /contacts/{id} in GoHighLevel -> Slack. This is the "AI
 *                transcription -> contact notes" job. It writes RAW DATA and
 *                the CRM. It does not touch this tab.
 *
 *   ORPHANED     HotProspector FetchLeadCallLogs -> assembly-ai:UploadFile ->
 *                assembly-ai:TranscribeAudio -> six openai CreateCompletion
 *                calls -> google-sheets:addRow to CALL SUMMARIES -> Slack.
 *                Fourteen modules sitting in metadata.designer.orphans, which
 *                is Make's word for detached from the trigger. Detached modules
 *                do not run.
 *
 * So the 215 rows this config imports are from whenever that chain was last
 * connected, and no amount of fixing the scenario's other problems will add a
 * 216th. The scenario separately filled Make's organisation-wide 500MB
 * incomplete-execution queue and was switched off for it, but that is a
 * different fault: clearing the queue and reactivating restores RAW DATA and
 * the CRM write, not this tab.
 *
 * If live per-agent call data matters more than the coaching text, RAW DATA is
 * the tab to import — the connected chain writes it, and it carries agent_name,
 * call_duration, call_disposition, call_direction, call_status and call_time,
 * one row per call. What it does not carry is the transcript, the summary, the
 * grading or the SOP answer, because those are produced by the six GPT modules
 * that are no longer attached to anything.
 *
 * WHAT WRITES THIS TAB, from the blueprint of the orphaned chain
 *
 * Module #56, google-sheets:addRow. Twelve values, in this order:
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
 * RAW DATA carries agent_name too, on the chain that is still connected, which
 * is the reason the note above suggests it as the live alternative.
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
    headers: [
      // The live sheet's own spelling, from the first import's
      // unrecognised-headers report.
      'lead phone number',
      'to number',
      'to_number',
      'number',
      'phone',
      'to',
      'dialled',
      'dialed',
    ],
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
    headers: [
      'call recording url',
      'audio url',
      'audio_url',
      'recording',
      'recording url',
      'audio',
    ],
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
      // What the sheet calls it. The scenario's prompt writes coaching FROM a
      // sales-audit grading, and the column took the audit's name.
      'call sales audit',
      'coaching',
      'coach',
      'sales coaching',
      'feedback',
      'audit',
      'sales audit',
      // 'grading' deliberately NOT here: it belongs to the grading field
      // below, and one spelling cannot mean two columns — the map builder
      // throws at module load if it does, which is how this was caught.
    ],
  },
  {
    /*
     * The audit's own score, which nobody said existed.
     *
     * Found in the first import's unrecognised-headers report — "Grading
     * (1-10)" — alongside "Call Process Followed?". Both are the AI sales
     * coach scoring itself, and both are more useful per agent than any
     * counter this import was built for.
     */
    field: 'grading',
    headers: ['grading (1-10)', 'grading', 'grade', 'score', 'call grading'],
  },
  {
    field: 'process_followed',
    headers: [
      'call process followed?',
      'call process followed',
      'process followed?',
      'process followed',
      'sop followed',
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

/*
 * NOTE ON THE POSITIONAL FALLBACK, now that the live sheet has been read.
 *
 * Its headings are on row 1 and they matched, so the fallback above was never
 * used — and it is now known to be incomplete: the real tab also carries
 * "Grading (1-10)" and "Call Process Followed?", which the blueprint's write
 * order does not account for. The fallback stays as a last resort for a tab
 * with no headings at all, and its error message already says that reading by
 * position is an assumption rather than a match.
 */
