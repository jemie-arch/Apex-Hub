/**
 * The two tabs the live pay calculation reads, and how to find their columns.
 *
 * Both live in "Apex - Call Center Agent Dashboard" — the same spreadsheet as
 * INPUT VALUES, so COMMISSION_INPUTS_SHEET_ID addresses all three.
 *
 * Headers are matched by name, not by position, for the reason the tracker
 * import already learned: these are tabs people add columns to, and a
 * positional read silently pairs the wrong column with the wrong field the
 * first time somebody inserts one.
 *
 * The observed headers are recorded here as the starting point. Anything
 * unmatched is reported by the sync rather than dropped, so one run corrects
 * this file instead of a series of guesses doing it.
 */

/** BOOKING SHEET. Six columns as observed on 3 September 2026. */
export const BOOKING_SHEET_RANGE = 'BOOKING SHEET!A:Z';

export const BOOKING_SHEET_COLUMNS: Readonly<Record<string, string>> = {
  // Column A, and the only date on the tab: the day the booking was made,
  // which is the day the bonus is earned against.
  date: 'booked_on',
  'booked on': 'booked_on',
  'date booked': 'booked_on',

  // Column B. The thing every payment is attributed by.
  agent: 'agent',
  'agent name': 'agent',

  'full name': 'patient_name',
  'patient name': 'patient_name',
  'lead name': 'patient_name',

  email: 'patient_email',
  'lead email': 'patient_email',

  'ghl location name': 'location_name',
  'location name': 'location_name',
  clinic: 'location_name',

  // Whether this carries attendance decides whether the daily bonus can
  // exclude no-shows at all, so it is imported even though nothing reads it yet.
  disposition: 'disposition',
  outcome: 'disposition',
  status: 'disposition',
};

/**
 * INVALID BOOKINGS — a hidden, form-linked tab.
 *
 * Hidden in the spreadsheet's own UI, which does not affect the API: values.get
 * returns a hidden tab exactly as it returns a visible one. That matters,
 * because the alternative was asking somebody to unhide it, and unhiding a tab
 * on a shared file changes what everyone else sees.
 *
 * The form's "Name of the lead" is deliberately NOT mapped. The calculation
 * needs the agent and the date; a patient's name copied into a second system
 * for no reason is a liability, not a record.
 */
export const INVALID_BOOKINGS_RANGE = 'INVALID BOOKINGS!A:Z';

export const INVALID_BOOKINGS_COLUMNS: Readonly<Record<string, string>> = {
  timestamp: 'reported_at',

  'name of agent full name': 'agent',
  'name of agent': 'agent',
  agent: 'agent',

  // The form's wording carries quotation marks, which normalisation strips.
  'reason for booking being invalid': 'reason',
  reason: 'reason',

  'date invalid was booked': 'invalid_on',
  'date booked': 'invalid_on',

  'additional notes': 'notes',
  notes: 'notes',
};

/** Lowercased, punctuation and quoting removed, spacing collapsed. */
export function normaliseSheetHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Fields without which a row cannot be paid on.
 *
 * A booking with no agent belongs to nobody and a booking with no date belongs
 * to no day. Both are still imported — see the sync — because they are the
 * shape of a live problem rather than a reason to discard the row: roughly half
 * of September's rows have a blank agent, and those bookings are currently
 * unpaid with nothing anywhere saying so.
 */
export const PAYABLE_FIELDS: readonly string[] = ['agent', 'booked_on'];
