/**
 * The tracker's leads tab, which nothing has ever synced.
 *
 * tracker_leads holds 1,103 rows, all stamped 22 August 2026, and there is no
 * sync for it — only the freshness alert in appointment-ledger, which has been
 * reporting it stale into a void. The Fulfilment page and lib/metrics read it,
 * and so does the Client Fulfilment Tracker: leads_best is
 * greatest(leads_windsor, leads_tracker), and with Windsor reporting nothing
 * for 30 of 35 accounts, the sheet IS the lead count.
 *
 * What that costs, in the figures the tracker actually printed:
 *
 *   week of 10 Aug   383 leads   $13,585 spend   CPL $35
 *   week of 17 Aug   228 leads   $11,020 spend   CPL $48
 *   week of 24 Aug     5 leads    $7,723 spend   CPL $1,545
 *   week of 31 Aug     1 lead     $8,844 spend   CPL $8,844
 *
 * Nothing changed in the advertising. The sheet stopped being imported on
 * 21 August and leads_best collapsed to whatever Windsor could see.
 *
 * WHY THE TAB IS NOT NAMED HERE
 *
 * The workbook has seventeen tabs and nobody has told us which holds the
 * leads. Guessing is what cost the appointments import two runs: its headers
 * were written from the shape of the database table rather than from the
 * sheet, and it demanded a column called "booked for" from a tab that says
 * "Date Booked". So this config lists candidates and the sync reports what it
 * found, rather than asserting one and failing opaquely.
 */

/**
 * A tab whose title suggests it holds leads, best guess first.
 *
 * "Leads Data" is first because that is what the workbook actually calls it —
 * confirmed by the first successful run, which had to fall back to a loose
 * match containing "lead" to find it. Naming it means the choice no longer
 * depends on tab order, and the report says "exact name" rather than a guess
 * that happened to land.
 */
export const LEADS_TAB_CANDIDATES: readonly string[] = [
  'Leads Data',
  'Lead Data',
  'Leads',
  'Lead Tracker',
  'All Leads',
  'Raw Leads',
  'Lead Log',
];

/**
 * Older lead tabs, kept for the history the live tab no longer carries.
 *
 * "Leads Data" holds only 33 rows earlier than 10 August 2026, so it is not
 * the record of anything before that — and the hand import of 22 August, which
 * had 377 leads in the first week of August alone, must have read one of these.
 * Importing them back is what restores that history.
 *
 * They are imported under their own source_tab, so a row 27 in each cannot
 * overwrite the other. Counting is deduplicated by v_tracker_leads_effective:
 * the live tab wins for any day it has a row for, and these fill only the days
 * it is silent about.
 */
export const HISTORICAL_LEADS_TABS: readonly string[] = [
  'Leads Data Old',
  'Lead Count Old',
];

/**
 * How a candidate is recognised in the workbook's real tab list.
 *
 * Deliberately loose — matched case-insensitively and by containment — because
 * a tab called "LEAD DATA (do not edit)" is the tab we want and an exact-match
 * rule would miss it. The sync reports every tab it saw either way, so a wrong
 * pick is visible rather than silent.
 *
 * It matches the historical tabs too, which is why the live tab is chosen from
 * LEADS_TAB_CANDIDATES by exact name first: "Leads Data Old" contains "lead"
 * and would otherwise be a legitimate answer to "which tab holds the leads".
 */
export function looksLikeLeadsTab(title: string): boolean {
  const lower = title.trim().toLowerCase();
  if (lower.includes('appointment')) return false; // that is the other tab

  /*
   * And never an old tab. These contain "lead" and are a perfectly good answer
   * to "which tab holds the leads" — but picking one as the LIVE tab would
   * report months-old history as this week and leave today unimported. They
   * are read on purpose, by importHistoricalTabs, under their own source_tab.
   */
  if (HISTORICAL_LEADS_TABS.some((old) => old.toLowerCase() === lower)) {
    return false;
  }

  return lower.includes('lead');
}

export interface LeadColumn {
  field: string;
  headers: readonly string[];
  required?: boolean;
}

/*
 * Several spellings each, for the same reason as the appointments map: these
 * are written from the shape of tracker_leads, not from the sheet, because the
 * sheet has never been read. The unrecognised-headers report is how this gets
 * corrected — in one pass, from one run.
 */
export const LEAD_COLUMNS: readonly LeadColumn[] = [
  {
    /*
     * The practice. Named company_name on the table rather than location_name,
     * which the appointments table uses for the same thing — worth knowing
     * before wondering why the two do not join on a shared column.
     */
    field: 'company_name',
    headers: [
      'company name',
      'company',
      'location name',
      'location',
      'practice',
      'practice name',
      'clinic',
      'clinic name',
      'client',
      'client name',
    ],
    required: true,
  },
  {
    field: 'received_on',
    headers: [
      'date',
      'date created',
      'created on',
      'created',
      'date added',
      'received',
      'received on',
      'lead date',
      'date of lead',
    ],
    required: true,
  },
  {
    field: 'lead_name',
    headers: ['name', 'lead name', 'full name', 'patient', 'patient name', 'contact'],
  },
  {
    /*
     * Usually 1, occasionally more — the table stores it rather than assuming,
     * and so does this. Absent is read as 1 by the sync, matching the view,
     * which already does coalesce(lead_count, 1).
     */
    field: 'lead_count',
    headers: ['leads', 'lead count', 'count', 'number of leads', 'qty', 'quantity'],
  },
  { field: 'campaign_external_id', headers: ['campaign id', 'campaign external id'] },
  { field: 'campaign_name', headers: ['campaign', 'campaign name'] },
  { field: 'adset_external_id', headers: ['ad set id', 'adset id'] },
  { field: 'adset_name', headers: ['ad set', 'adset', 'ad set name', 'adset name'] },
  { field: 'ad_external_id', headers: ['ad id', 'ad external id'] },
  { field: 'ad_name', headers: ['ad', 'ad name'] },
];

/** Normalised for comparison: case, surrounding space and inner runs of space. */
export function normaliseLeadHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Header text to field, built once.
 *
 * Throws at module load on a spelling claimed by two fields, which would
 * otherwise make the mapping depend on declaration order — the kind of thing
 * that works until somebody adds a column.
 */
export const LEAD_HEADER_TO_FIELD: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const column of LEAD_COLUMNS) {
    for (const header of column.headers) {
      const key = normaliseLeadHeader(header);
      const existing = map.get(key);
      if (existing && existing !== column.field) {
        throw new Error(
          `Lead header "${header}" is claimed by both ${existing} and ` +
            `${column.field}. One spelling cannot mean two columns.`,
        );
      }
      map.set(key, column.field);
    }
  }
  return map;
})();

export const LEAD_REQUIRED_FIELDS: readonly string[] = LEAD_COLUMNS.filter(
  (column) => column.required,
).map((column) => column.field);
