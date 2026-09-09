/**
 * The RAW DATA tab, which is the tab agent pay is actually calculated from.
 *
 * Make scenario 5560467 module #5 appends one row here per call, by position
 * with `useColumnHeaders: false`. The pay dashboard's cell J2 then counts it:
 *
 *   COUNTIFS('RAW DATA'!C:C, <agent>, 'RAW DATA'!N:N, "*Booked*", <date bounds>)
 *
 * So column C is the agent, column N is the disposition, and column A is the
 * date the COUNTIFS bounds. Everything about agent commission follows from
 * those three columns, which is why this import exists — see migration 0064 for
 * the reconciliation it settles.
 *
 * WHAT THE SCENARIO WRITES, from its own blueprint
 *
 * Twenty-two values, in this order:
 *
 *   0  call_time          A
 *   1  source             B
 *   2  agent_name         C   <- the agent J2 matches
 *   3  call_duration      D
 *   4  last_name          E   PHI, not imported
 *   5  email              F   PHI, not imported
 *   6  call_time          G   the same value as 0, written twice
 *   7  stage_entry_date   H
 *   8  first_name         I   PHI, not imported
 *   9  from_number        J
 *   10 ghl_location_name  K
 *   11 groupId            L
 *   12 mobile             M   PHI, not imported
 *   13 call_dispostion    N   <- the disposition J2 matches
 *   14 leadId             O
 *   15 memberId           P
 *   16 to_number          Q
 *   17 call_direction     R
 *   18 country_code       S
 *   19 time_zone          T
 *   20 call_status        U
 *   21 lead_created_date  V
 *
 * "call_dispostion" is the scenario's own misspelling, and it is in the aliases
 * below because matching the sheet matters more than spelling it correctly.
 *
 * FOUR COLUMNS ARE DELIBERATELY NOT IMPORTED
 *
 * last_name, email, first_name and mobile are patient identifiers. None is
 * needed to count a booking or measure an agent, so none is read. lead_crm_id
 * reaches the contact in GoHighLevel for anybody entitled to look. Collecting a
 * patient's name to calculate commission would be collecting it for no reason.
 *
 * COLUMN ORDER IS NOT ASSUMED
 *
 * The scenario writes by position, so the tab's headings are whatever somebody
 * typed above those columns and may not match the field names at all. Headings
 * are matched by spelling like every other sheet here, and the first run reports
 * every heading it could not place. Guessing a column cost the appointments
 * import two runs and the booking sheet two more.
 */

/** The call centre workbook — the same spreadsheet the summaries come from. */
export const RAW_CALL_SHEET_ID =
  process.env['RAW_CALL_SHEET_ID'] ??
  '1NyLCtIiXYIO6VzfTqhZ98F62CZ_s6rblbWzECqyY7p8';

/** Tab titles to try, in order. Confirmed from the live workbook's tab list. */
export const RAW_CALL_TAB_CANDIDATES: readonly string[] = [
  'RAW DATA',
  'Raw Data',
  'RAW_DATA',
];

/** A tab that looks like the raw feed, if none of the above matches. */
export function looksLikeRawTab(title: string): boolean {
  const lower = title.trim().toLowerCase();
  // CALL SUMMARIES is the transcribed feed and APPOINTMENT DATA is bookings;
  // neither is the per-call raw log.
  if (lower.includes('summar')) return false;
  if (lower.includes('appointment')) return false;
  return lower.includes('raw');
}

export interface RawCallColumn {
  field: string;
  headers: readonly string[];
  required?: boolean;
}

export const RAW_CALL_COLUMNS: readonly RawCallColumn[] = [
  {
    /* Column A. Required: a row with no date cannot be counted in any window. */
    field: 'called_at',
    // NOT 'timestamp': that spelling belongs to called_at_secondary below,
    // and one spelling cannot mean two columns — the map builder throws on it.
    headers: ['call time', 'call_time', 'called at', 'date', 'call date'],
    required: true,
  },
  {
    /*
     * Column C. Required, because a row naming no agent is a booking credited
     * to nobody — and crediting bookings is the entire purpose of this import.
     */
    field: 'agent_name',
    headers: ['agent name', 'agent_name', 'agent', 'caller name', 'caller_name', 'caller', 'isr', 'rep'],
    required: true,
  },
  {
    /*
     * Column N. Required for the same reason: the booked test reads this, and a
     * missing disposition silently reduces somebody's pay rather than erroring.
     */
    field: 'disposition',
    headers: [
      // The scenario's own spelling first — this is what the live tab most
      // likely says.
      'call_dispostion',
      'call dispostion',
      'call_disposition',
      'call disposition',
      'disposition',
      'dispostion',
      'outcome',
      'result',
    ],
    required: true,
  },
  {
    /*
     * The other call_time column.
     *
     * Module #5 writes call_time into BOTH column A and column G, and whoever
     * typed the headings gave them different names — the first import mapped
     * one of them and reported "Time Stamp" as unrecognised. That mattered:
     * 590 rows came in with no readable date, including 16 of Karol Sanchez's
     * bookings and 18 of Jennelyn Salazar's, and a row with no date falls
     * outside every window the dashboard offers, including the one commission
     * is paid on.
     *
     * So both columns are mapped and the sync takes whichever parses. Which of
     * the two is populated is not something to assume — this way it does not
     * have to be known.
     */
    field: 'called_at_secondary',
    headers: ['time stamp', 'timestamp', 'time_stamp'],
  },
  {
    field: 'duration_seconds',
    headers: ['call duration', 'call_duration', 'duration', 'length', 'talk time'],
  },
  { field: 'lead_source', headers: ['source', 'lead source', 'lead_source'] },
  {
    field: 'location_name',
    headers: [
      'ghl_location_name',
      'ghl location name',
      'location name',
      'location',
      'practice',
      'clinic',
    ],
  },
  { field: 'lead_crm_id', headers: ['leadid', 'lead id', 'contact id', 'contactid'] },
  { field: 'member_crm_id', headers: ['memberid', 'member id'] },
  { field: 'group_crm_id', headers: ['groupid', 'group id'] },
  { field: 'from_number', headers: ['from_number', 'from number', 'from'] },
  { field: 'to_number', headers: ['to_number', 'to number', 'to', 'dialled', 'dialed'] },
  { field: 'direction', headers: ['call_direction', 'call direction', 'direction'] },
  { field: 'status', headers: ['call_status', 'call status', 'status'] },
  { field: 'country_code', headers: ['country_code', 'country code', 'country'] },
  { field: 'time_zone', headers: ['time_zone', 'time zone', 'timezone', 'tz'] },
  {
    field: 'stage_entry_date',
    headers: ['stage_entry_date', 'stage entry date', 'stage entry'],
  },
  {
    field: 'lead_created_date',
    headers: [
      // The live sheet's spelling, from the first import's
      // unrecognised-headers report.
      'date contact created',
      'lead_created_date',
      'lead created date',
      'lead created',
    ],
  },
];

/** Normalised for comparison: case, surrounding space and inner runs of space. */
export function normaliseRawHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Header text to field, built once.
 *
 * Throws at module load on a spelling claimed by two fields, which would make
 * the mapping depend on declaration order. The call-summaries config learned
 * this the hard way — 'grading' was claimed twice and only executing the map
 * caught it, because a type checker cannot see a duplicate map key.
 */
export const RAW_CALL_HEADER_TO_FIELD: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const column of RAW_CALL_COLUMNS) {
    for (const header of column.headers) {
      const key = normaliseRawHeader(header);
      const existing = map.get(key);
      if (existing && existing !== column.field) {
        throw new Error(
          `RAW DATA header "${header}" is claimed by both ${existing} and ` +
            `${column.field}. One spelling cannot mean two columns.`,
        );
      }
      map.set(key, column.field);
    }
  }
  return map;
})();

export const RAW_CALL_REQUIRED_FIELDS: readonly string[] = RAW_CALL_COLUMNS.filter(
  (column) => column.required,
).map((column) => column.field);

/**
 * Positional fallback, used only when the tab has no usable header row.
 *
 * The scenario writes by position with useColumnHeaders false, so a tab whose
 * top row is data — or whose headings nobody ever typed — is a real
 * possibility. This is the blueprint's write order, so reading by position
 * beats importing nothing.
 *
 * Reported loudly when used, because it is an assumption rather than a match:
 * if the scenario is ever edited to write a different order, this silently
 * files a disposition as a direction and quietly changes what people are paid.
 *
 * The four nulls are the patient columns, skipped by design, plus the duplicate
 * call_time at index 6.
 */
export const RAW_CALL_POSITIONAL_ORDER: readonly (string | null)[] = [
  'called_at',
  'lead_source',
  'agent_name',
  'duration_seconds',
  null, // E last_name — PHI
  null, // F email — PHI
  'called_at_secondary', // G call_time again, mapped so a blank column A still dates the row
  'stage_entry_date',
  null, // I first_name — PHI
  'from_number',
  'location_name',
  'group_crm_id',
  null, // M mobile — PHI
  'disposition',
  'lead_crm_id',
  'member_crm_id',
  'to_number',
  'direction',
  'country_code',
  'time_zone',
  'status',
  'lead_created_date',
];
