import type { ReactNode } from 'react';

import { cplTone } from '@/config/cft-dashboard';
import type { DashboardRow, Derived } from '@/lib/cft-stats';
import { formatMoney, formatPercent } from '@/lib/format';

/**
 * How each of the sheet's columns is drawn, keyed by its column letter.
 *
 * Kept apart from lib/cft-columns, which holds the same columns as data — their
 * letters, sort values and which grain can supply them. That file is imported
 * by the check script, and JSX in it fails to compile outside Next's runtime;
 * more usefully, the split means the sortable value and the rendered string are
 * visibly two different things. Show % sorts on 0.4 and renders "40.0%".
 */

const dash = <span className="text-fg-subtle">—</span>;

const count = (value: number): string => value.toLocaleString();

/** A ratio with no denominator is blank, never zero. */
const pct = (value: number | null): ReactNode =>
  value === null ? dash : formatPercent(value, 1);

const money = (value: number | null): ReactNode =>
  value === null ? dash : formatMoney(Math.round(value * 100));

const TONE_CLASS: Record<string, string> = {
  positive: 'bg-positive-subtle text-positive',
  warning: 'bg-warning-subtle text-warning',
  negative: 'bg-negative-subtle text-negative',
  neutral: 'bg-neutral-subtle text-fg-muted',
};

export type Renderer = (row: DashboardRow, derived: Derived) => ReactNode;

export const RENDERERS: Record<string, Renderer> = {
  // A, AC and AD have no Hub source at all; they render empty.
  A: () => null,
  B: (row) => row.status ?? dash,
  C: (row) => row.clientName ?? dash,
  // 118 of 1,281 tracker appointments carry no campaign id. Named rather than
  // blank, so the row reads as real with a missing attribute.
  D: (row) => row.campaignName ?? <span className="text-fg-subtle">(no campaign)</span>,
  E: (row) => row.campaignId ?? dash,
  F: (row) => row.offerName ?? dash,

  G: (row) => formatMoney(row.spendCents),
  H: (row) => count(row.leads),
  I: (_row, d) => {
    const tone = cplTone(d.cpl);
    return tone ? (
      <span className={`rounded px-1.5 py-0.5 font-medium ${TONE_CLASS[tone]}`}>
        {money(d.cpl)}
      </span>
    ) : (
      money(d.cpl)
    );
  },

  J: (row) => (row.calls ? count(row.calls.dialed) : null),
  K: (row) => (row.calls ? count(row.calls.calls2min) : null),
  /*
   * The set-aside count sits beside the average. Values over 24 hours are
   * excluded from both sum and count, so a large bracket means stale
   * lead_created_at timestamps rather than a slow team — and without it on
   * screen the average looks better than the data deserves.
   */
  L: (row, d) => {
    if (!row.calls) return null;
    if (d.speedToLead === null) return dash;
    return (
      <>
        {d.speedToLead.toFixed(1)}
        {row.calls.speedToLeadOver24h > 0 ? (
          <span className="ml-1 text-fg-subtle">(+{row.calls.speedToLeadOver24h})</span>
        ) : null}
      </>
    );
  },
  M: (row, d) => (row.calls ? pct(d.pickupPct) : null),
  N: (row, d) => (row.calls ? pct(d.conversationPct) : null),
  O: (row, d) =>
    !row.calls ? null : d.dialsPerLead === null ? dash : d.dialsPerLead.toFixed(1),

  P: (row) => count(row.apptsCreated),
  Q: (row) => count(row.apptsToBeTaken),
  R: (row) => row.lastApptDate ?? dash,
  S: (_row, d) => pct(d.schedulePct),
  T: (row) => count(row.shows),
  U: (row) => count(row.noShows),
  V: (row) => count(row.cancels),
  W: (row) => count(row.dqs),
  X: (_row, d) => pct(d.dqPct),
  Y: (_row, d) => pct(d.cancelPct),
  Z: (_row, d) => pct(d.showPct),

  AA: (row) => count(row.closes),
  AB: (_row, d) => pct(d.closePct),
  AC: () => null,
  AD: () => null,

  AE: (_row, d) => money(d.costPerBooking),
  AF: (_row, d) => money(d.costPerShow),
  AG: (_row, d) => money(d.costPerClose),
};
