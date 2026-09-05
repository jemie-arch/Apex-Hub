import type { Breakdown, DashboardRow, Derived } from '@/lib/cft-stats';

/**
 * The 33 columns of the sheet's STATS DASHBOARD tab, as data.
 *
 * Written as a list rather than as hand-rolled JSX because three things have to
 * agree about every column and did not when they were written out separately:
 * its sheet letter, how it sorts, and whether it can be sourced at the grain
 * currently on screen. A column is one entry here and all three follow from it.
 *
 * `value` is what sorting and the totals read; `render` is what a person sees.
 * They are deliberately separate — Show % sorts on 0.4 and renders "40.0%", and
 * a blank sorts as null rather than as zero, so empty rows collect at one end
 * instead of pretending to be the best performers.
 */

export interface Column {
  /** The sheet's own column letter, printed under the heading. */
  letter: string;
  heading: string;
  align: 'left' | 'right';
  value: (row: DashboardRow, derived: Derived) => number | string | null;
  /**
   * True when this column cannot be sourced at the breakdown on screen.
   *
   * Rendered hatched rather than blank. A blank cell reads as "zero, or nobody
   * filled it in"; hatching reads as "this cannot be known here", which is the
   * truth for call data on a campaign row and is what the legend explains.
   */
  blockedAt?: (breakdown: Breakdown) => boolean;
  /** True when nothing in the Hub can ever supply it. */
  noSource?: boolean;
  /**
   * Cap for a free-text column, in pixels.
   *
   * Without one, a cell sizes itself to its longest value: an offer name like
   * "Apex | Hancock & Johnston Dentistry | $3497 Total Price for Invisalign and
   * $1,000 off on Braces - Copy" made its column wider than the screen and
   * pushed every money column out of view. Numeric columns need no cap — their
   * content is short by nature.
   */
  maxWidth?: number;
}

/** Section headers, sheet row 4. */
export const SECTIONS = [
  { label: '', span: 1 },
  { label: 'CAMPAIGN INFORMATION', span: 5 },
  { label: '1. AD DATA', span: 3 },
  { label: '2. CALL DATA', span: 6 },
  { label: '3. APPOINTMENT DATA', span: 11 },
  { label: '4. DEALS', span: 4 },
  { label: '5. KPI METRICS', span: 3 },
] as const;

/** Sheet letters A through AG, in order. */
export const LETTERS: string[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'ABCDEFG'.split('').map((letter) => `A${letter}`),
];


/** Columns J to O: client grain only. */
const callsOnly = (breakdown: Breakdown): boolean => breakdown === 'campaign';

export const COLUMNS: Column[] = [
  // A — typed by hand in the sheet; no Hub store exists.
  {
    letter: 'A',
    heading: 'Notes',
    align: 'left',
    noSource: true,
    value: () => null,
  },
  {
    letter: 'B',
    heading: 'Status',
    align: 'left',
    value: (row) => row.status,
  },
  {
    letter: 'C',
    heading: 'Client Name',
    align: 'left',
    value: (row) => row.clientName,
  },
  {
    letter: 'D',
    heading: 'Campaign Name',
    align: 'left',
    value: (row) => row.campaignName,
    // 118 of 1,281 tracker appointments carry no campaign id. Named rather than
    // left blank, so the row reads as a real one with a missing attribute.
  },
  {
    letter: 'E',
    heading: 'Campaign ID',
    align: 'left',
    value: (row) => row.campaignId,
  },
  {
    letter: 'F',
    heading: 'Offer Name',
    align: 'left',
    maxWidth: 170,
    value: (row) => row.offerName,
  },

  // 1. AD DATA
  {
    letter: 'G',
    heading: 'Amount Spent',
    align: 'right',
    value: (row) => row.spendCents,
  },
  {
    letter: 'H',
    heading: 'Leads',
    align: 'right',
    value: (row) => row.leads,
  },
  {
    letter: 'I',
    heading: 'CPL',
    align: 'right',
    value: (_row, derived) => derived.cpl,
  },

  // 2. CALL DATA — client grain only.
  {
    letter: 'J',
    heading: 'Number of dialed calls',
    align: 'right',
    blockedAt: callsOnly,
    value: (row) => row.calls?.dialed ?? null,
  },
  {
    letter: 'K',
    heading: 'Calls 2+ minutes',
    align: 'right',
    blockedAt: callsOnly,
    value: (row) => row.calls?.calls2min ?? null,
  },
  {
    letter: 'L',
    heading: 'Speed To Lead (minutes)',
    align: 'right',
    blockedAt: callsOnly,
    value: (_row, derived) => derived.speedToLead,
    /*
     * The set-aside count sits beside the average. Values over 24 hours are
     * excluded from both sum and count, so a large bracket means stale
     * lead_created_at timestamps rather than a slow team — and without the
     * count on screen the average looks better than the data deserves.
     */
  },
  {
    letter: 'M',
    heading: 'Pickup %',
    align: 'right',
    blockedAt: callsOnly,
    value: (_row, derived) => derived.pickupPct,
  },
  {
    letter: 'N',
    heading: 'Conversation %',
    align: 'right',
    blockedAt: callsOnly,
    value: (_row, derived) => derived.conversationPct,
  },
  {
    letter: 'O',
    heading: 'Dials per Lead',
    align: 'right',
    blockedAt: callsOnly,
    value: (_row, derived) => derived.dialsPerLead,
  },

  // 3. APPOINTMENT DATA
  {
    letter: 'P',
    heading: 'Appointments Created',
    align: 'right',
    value: (row) => row.apptsCreated,
  },
  {
    letter: 'Q',
    heading: 'Appointments To Be Taken',
    align: 'right',
    value: (row) => row.apptsToBeTaken,
  },
  {
    letter: 'R',
    heading: 'Last Appt Date',
    align: 'right',
    value: (row) => row.lastApptDate,
  },
  {
    letter: 'S',
    heading: 'Schedule %',
    align: 'right',
    value: (_row, derived) => derived.schedulePct,
  },
  {
    letter: 'T',
    heading: 'Shows',
    align: 'right',
    value: (row) => row.shows,
  },
  {
    letter: 'U',
    heading: 'No Shows',
    align: 'right',
    value: (row) => row.noShows,
  },
  {
    letter: 'V',
    heading: 'Cancels',
    align: 'right',
    value: (row) => row.cancels,
  },
  {
    letter: 'W',
    heading: "DQ's",
    align: 'right',
    value: (row) => row.dqs,
  },
  {
    letter: 'X',
    heading: 'DQ %',
    align: 'right',
    value: (_row, derived) => derived.dqPct,
  },
  {
    letter: 'Y',
    heading: 'Cancel %',
    align: 'right',
    value: (_row, derived) => derived.cancelPct,
  },
  {
    letter: 'Z',
    heading: 'Show %',
    align: 'right',
    value: (_row, derived) => derived.showPct,
  },

  // 4. DEALS
  {
    letter: 'AA',
    heading: 'Closes',
    align: 'right',
    value: (row) => row.closes,
  },
  {
    letter: 'AB',
    heading: 'Close %',
    align: 'right',
    value: (_row, derived) => derived.closePct,
  },
  /*
   * Revenue means patient case value, which the Hub records nowhere.
   * billing_charges holds what Apex charges per consult — a different quantity
   * — so it is deliberately not substituted, and ROI depends on it.
   */
  {
    letter: 'AC',
    heading: 'Revenue',
    align: 'right',
    noSource: true,
    value: () => null,
  },
  {
    letter: 'AD',
    heading: 'ROI',
    align: 'right',
    noSource: true,
    value: () => null,
  },

  // 5. KPI METRICS
  {
    letter: 'AE',
    heading: 'Cost Per Booking',
    align: 'right',
    value: (_row, derived) => derived.costPerBooking,
  },
  {
    letter: 'AF',
    heading: 'Cost Per Show',
    align: 'right',
    value: (_row, derived) => derived.costPerShow,
  },
  {
    letter: 'AG',
    heading: 'Cost Per Close',
    align: 'right',
    value: (_row, derived) => derived.costPerClose,
  },
];

/** Fixed widths for the frozen columns A-E, matching the sheet's frozen panes. */
export const FROZEN_WIDTHS = [36, 76, 156, 180, 124];

export const LEFT_OFFSETS = FROZEN_WIDTHS.reduce<number[]>((offsets, width, index) => {
  offsets.push(index === 0 ? 0 : offsets[index - 1]! + FROZEN_WIDTHS[index - 1]!);
  return offsets;
}, []);
