/**
 * Which column in the Client Fulfilment Tracker means what.
 *
 * Matched on header text, not position. A tracker somebody works in every day
 * gets columns inserted, hidden and reordered, and a sync that reads "column G"
 * silently reads the wrong thing the first time that happens — which is exactly
 * how the consolidated Make scenarios ended up filtering on a positional column
 * letter and nobody noticing.
 *
 * Several spellings per field, for the same reason. Reading the live onboarding
 * form on 2 September found that two of its four mapped question labels had
 * been rewritten since the stored payloads were captured — "Clinic Friendly
 * Name" had become "Clinic Name", and the data-points question was a different
 * sentence entirely. Both would have failed silently. So every field here
 * accepts the spellings it might plausibly carry, and the sync reports any
 * header it did not recognise rather than dropping it quietly.
 *
 * THE HEADERS BELOW ARE NOT CONFIRMED. They are written from the shape of
 * tracker_appointments, which was populated by a hand import whose column
 * mapping nobody wrote down. The first real run prints every header it saw and
 * every one it could not place — that output is how this list gets corrected,
 * and it is the reason the sync reports unmatched headers as loudly as it
 * reports rows.
 */

/** A tracker field, and the header spellings that mean it. */
export interface TrackerColumn {
  /** Column on tracker_appointments. */
  field: string;
  /** Header spellings, compared case- and space-insensitively. */
  headers: readonly string[];
  /**
   * Whether a row without this is worth keeping.
   *
   * Only the patient name and the appointment date are required. A row missing
   * either is not an appointment anybody can act on, and importing it would put
   * a blank line in a reconciliation that is meant to be the count of real
   * consultations.
   */
  required?: boolean;
}

export const TRACKER_COLUMNS: readonly TrackerColumn[] = [
  {
    field: 'location_name',
    headers: ['location', 'location name', 'practice', 'practice name', 'clinic', 'clinic name'],
  },
  {
    field: 'patient_name',
    headers: ['name', 'patient', 'patient name', 'full name', 'lead name'],
    required: true,
  },
  {
    field: 'patient_email',
    headers: ['email', 'patient email', 'lead email'],
  },
  {
    field: 'created_on',
    headers: ['date added', 'created', 'created on', 'date created', 'booked on'],
  },
  {
    /*
     * "Date Booked" is the sheet's own spelling, column D, and its absence is
     * what stopped every run until now: the import read fourteen headings,
     * matched ten, and refused to write a row because the one column it cannot
     * do without was called something this map had never heard of.
     *
     * Note how close it sits to "Date Created" in column C, which maps to
     * created_on. Booked means the appointment; created means the booking.
     * Reading them the wrong way round would move every consultation in the
     * Hub to the day it was set.
     */
    field: 'booked_for',
    headers: [
      'date booked',
      'app date',
      'appointment date',
      'booked for',
      'appt date',
      'consult date',
    ],
    required: true,
  },
  {
    /*
     * THIS COLUMN DOES NOT EXIST IN THE TRACKER. Kept, and kept documented.
     *
     * This sync was built on the belief that the tracker names whoever set each
     * appointment, and that belief is why tracker_appointments has a booked_by
     * column at all. The first successful read settled it — fourteen headings
     * on row 4, not one of them an agent, a setter or an ISR:
     *
     *   Month Created | Month Booked | Date Created | Date Booked |
     *   Location Name | Name | Email | Campaign ID | Ad Set ID | Ad ID |
     *   Offer Name | Appointment Status | Status if Showed | Amount Spent
     *
     * So attribution never lived here. It lives in BOOKING SHEET column B on
     * the Call Center Agent Dashboard, which is what sync/booking-sheet reads
     * and what the live pay calculation already runs on.
     *
     * The spellings stay because they cost nothing and the tracker gains
     * columns regularly; the day one appears, it is picked up without a code
     * change. What must not happen is somebody reading booked_by, finding it
     * null on every row, and concluding the import is broken.
     */
    field: 'booked_by',
    headers: ['booked by', 'agent', 'isr', 'set by', 'appointment setter', 'booker'],
  },
  {
    field: 'appointment_status',
    headers: ['status', 'appointment status', 'appt status', 'show status'],
  },
  {
    field: 'status_if_showed',
    headers: [
      'status if showed',
      'outcome',
      'result',
      'disposition',
      'status if showed?',
    ],
  },
  {
    field: 'offer_name',
    headers: ['offer', 'offer name', 'promotion', 'treatment'],
  },
  {
    field: 'campaign_external_id',
    headers: ['campaign id', 'campaign', 'campaign external id'],
  },
  {
    field: 'adset_external_id',
    headers: ['ad set id', 'adset id', 'ad set', 'adset'],
  },
  {
    field: 'ad_external_id',
    headers: ['ad id', 'ad', 'ad external id'],
  },
  {
    /*
     * Column N. tracker_appointments has had amount_spent_cents since 0001 and
     * nothing has ever filled it.
     *
     * Read, and deliberately not used as the spend figure anywhere: reported
     * spend comes from Windsor at ad-and-day grain and reconciles against Meta
     * day for day. This is a per-appointment number typed into a spreadsheet,
     * worth storing so the two can be compared and not worth trusting over the
     * source that can be checked.
     */
    field: 'amount_spent',
    headers: ['amount spent', 'spend', 'cost'],
  },
];

/**
 * Columns the tracker has that the Hub deliberately does not import.
 *
 * Month Created and Month Booked are the month labels of Date Created and Date
 * Booked, derived in the sheet for pivoting. Importing them would store the
 * same fact twice in two formats, and the second copy is the one that goes
 * stale — every month question the Hub asks is answered by date_trunc on the
 * date it already has.
 *
 * The point of naming them is the unrecognised-headers report. That report is
 * how a new column gets noticed, and a report that lists the same two known
 * headings after every single run is one nobody reads by the third week.
 * Listed here they stop being noise, and anything genuinely new stands out.
 */
export const IGNORED_HEADERS: readonly string[] = ['month created', 'month booked'];

/** Normalised for comparison: case, surrounding space and inner runs of space. */
export function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Header text to tracker field, built once from the table above.
 *
 * A duplicate spelling across two fields would make the mapping depend on
 * declaration order, which is the kind of thing that works until somebody adds
 * a column. Thrown at module load rather than discovered in a sync.
 */
export const HEADER_TO_FIELD: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const column of TRACKER_COLUMNS) {
    for (const header of column.headers) {
      const key = normaliseHeader(header);
      const existing = map.get(key);
      if (existing && existing !== column.field) {
        throw new Error(
          `Tracker header "${header}" is claimed by both ${existing} and ` +
            `${column.field}. One spelling cannot mean two columns.`,
        );
      }
      map.set(key, column.field);
    }
  }
  return map;
})();

export const REQUIRED_FIELDS: readonly string[] = TRACKER_COLUMNS.filter(
  (column) => column.required,
).map((column) => column.field);

/**
 * The tab and range read from the tracker.
 *
 * A wide range on purpose: the sheet is worked in daily and gains columns, and
 * asking for A:Z means a new one appears in the unmatched-headers report rather
 * than being invisible. Rows are unbounded — Sheets returns only what exists.
 */
export const TRACKER_RANGE = 'Appointment Data!A:Z';

/*
 * The commission unit rate is NOT in this spreadsheet.
 *
 * It was described as "B12 in sheet input values", which read as a tab of the
 * tracker. The tracker has seventeen tabs and no such title; its only
 * input-shaped one is INPUT CLIENT INFO, a list of clinics whose B12 holds the
 * client name "Dental Illusions".
 *
 * The rate lives in a separate spreadsheet, pointed at by
 * COMMISSION_INPUTS_SHEET_ID and COMMISSION_UNIT_RANGE. Left recorded here so
 * nobody re-adds a tab guess to this file and re-derives a rate of zero.
 */
