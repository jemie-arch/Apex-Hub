import { cplTone } from '@/config/cft-dashboard';
import {
  type Breakdown,
  type DashboardRow,
  derive,
} from '@/lib/cft-stats';
import { formatMoney, formatPercent } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * The STATS DASHBOARD tab, column for column.
 *
 * Thirty-three columns in the sheet's own order under the sheet's own six
 * section headers, because its whole purpose is that somebody who knows the
 * spreadsheet can read this without relearning it. Columns are not reordered,
 * renamed or dropped for tidiness — including the three that have no Hub source
 * and render blank, since a missing column reads as an oversight while a blank
 * one reads as a gap.
 *
 * Frozen columns are done with `position: sticky` and explicit left offsets,
 * which is the pattern already used on the client comparison page. The offsets
 * have to be computed from real widths, so the five frozen columns carry fixed
 * widths and everything else is free.
 *
 * The table sets `border-separate`, not the Tailwind default of
 * `border-collapse: collapse`. Collapsed borders are painted by the table
 * rather than the cell, so a sticky cell scrolls out from under its own border
 * and leaves a gap down the frozen edge.
 */

/** Fixed widths for the frozen columns, in order. Left offsets derive from these. */
const FROZEN = [
  { label: 'Notes', width: 56 },
  { label: 'Status', width: 88 },
  { label: 'Client Name', width: 170 },
  { label: 'Campaign Name', width: 200 },
  { label: 'Campaign ID', width: 130 },
] as const;

const LEFT_OFFSETS = FROZEN.reduce<number[]>((offsets, column, index) => {
  offsets.push(index === 0 ? 0 : offsets[index - 1]! + FROZEN[index - 1]!.width);
  return offsets;
}, []);

/** Section headers, sheet row 4. The first column sits under no section. */
const SECTIONS = [
  { label: '', span: 1 },
  { label: 'CAMPAIGN INFORMATION', span: 5 },
  { label: '1. AD DATA', span: 3 },
  { label: '2. CALL DATA', span: 6 },
  { label: '3. APPOINTMENT DATA', span: 11 },
  { label: '4. DEALS', span: 4 },
  { label: '5. KPI METRICS', span: 3 },
] as const;

/** Column headings, sheet row 5, in sheet order A to AG. */
const HEADINGS = [
  'Notes',
  'Status',
  'Client Name',
  'Campaign Name',
  'Campaign ID',
  'Offer Name',
  'Amount Spent',
  'Leads',
  'CPL',
  'Number of dialed calls',
  'Calls 2+ minutes',
  'Speed To Lead (minutes)',
  'Pickup %',
  'Conversation %',
  'Dials per Lead',
  'Appointments Created',
  'Appointments To Be Taken',
  'Last Appt Date',
  'Schedule %',
  'Shows',
  'No Shows',
  'Cancels',
  "DQ's",
  'DQ %',
  'Cancel %',
  'Show %',
  'Closes',
  'Close %',
  'Revenue',
  'ROI',
  'Cost Per Booking',
  'Cost Per Show',
  'Cost Per Close',
] as const;

const num = (value: number): string => value.toLocaleString();

/** A figure that has no denominator is blank, never zero. */
const pct = (value: number | null): string =>
  value === null ? '—' : formatPercent(value, 1);

const money = (value: number | null): string =>
  value === null ? '—' : formatMoney(Math.round(value * 100));

const TONE_CLASS: Record<string, string> = {
  positive: 'text-positive',
  warning: 'text-warning',
  negative: 'text-negative',
  neutral: 'text-fg-muted',
};

function Frozen({
  index,
  children = null,
  total,
  header,
}: {
  index: number;
  children?: React.ReactNode;
  total?: boolean;
  header?: boolean;
}) {
  const column = FROZEN[index]!;
  return (
    <td
      style={{ left: LEFT_OFFSETS[index], width: column.width, minWidth: column.width }}
      className={cn(
        'sticky z-10 border-b border-line px-3 py-2',
        total ? 'bg-surface-sunken font-semibold' : 'bg-surface',
        header && 'font-medium',
      )}
    >
      {children}
    </td>
  );
}

function Num({
  children = null,
  total,
  className,
}: {
  children: React.ReactNode;
  total?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        'numeric whitespace-nowrap border-b border-line px-3 py-2 text-right',
        total ? 'bg-surface-sunken font-semibold text-fg' : 'text-fg-muted',
        className,
      )}
    >
      {children}
    </td>
  );
}

function Row({ row, breakdown, total }: { row: DashboardRow; breakdown: Breakdown; total?: boolean }) {
  const d = derive(row);
  const calls = row.calls;
  const tone = cplTone(d.cpl);

  /*
   * Call columns are blank in a campaign breakdown rather than repeating the
   * client's total on each of its campaign rows. The calls table has no
   * campaign reference at all, so the client figure is not this campaign's
   * share of anything — printing it on five campaign rows would show the same
   * calls five times.
   */
  const callCell = (value: string) => (calls ? value : '—');

  return (
    <tr className={cn(!total && 'hover:bg-surface-hover')}>
      <Frozen index={0} total={total}>
        {/* Column A is typed by hand in the sheet. No Hub store exists. */}
      </Frozen>
      <Frozen index={1} total={total}>
        <span className="text-xs text-fg-muted">{total ? '' : (row.status ?? '—')}</span>
      </Frozen>
      <Frozen index={2} total={total} header>
        <span className="truncate text-fg">{total ? 'Total' : (row.clientName ?? '—')}</span>
      </Frozen>
      <Frozen index={3} total={total}>
        <span className="text-fg-muted">
          {total ? '' : breakdown === 'client' ? '—' : (row.campaignName ?? '(no campaign)')}
        </span>
      </Frozen>
      <Frozen index={4} total={total}>
        <span className="numeric text-xs text-fg-subtle">
          {total ? '' : (row.campaignId ?? '—')}
        </span>
      </Frozen>

      <Num total={total} className="text-left">
        {total ? '' : (row.offerName ?? '—')}
      </Num>

      {/* 1. AD DATA */}
      <Num total={total}>{formatMoney(row.spendCents)}</Num>
      <Num total={total}>{num(row.leads)}</Num>
      <Num total={total} className={tone ? TONE_CLASS[tone] : undefined}>
        {money(d.cpl)}
      </Num>

      {/* 2. CALL DATA — client grain only */}
      <Num total={total}>{callCell(num(calls?.dialed ?? 0))}</Num>
      <Num total={total}>{callCell(num(calls?.calls2min ?? 0))}</Num>
      <Num total={total}>
        {calls
          ? d.speedToLead === null
            ? '—'
            : `${d.speedToLead.toFixed(1)}${calls.speedToLeadOver24h > 0 ? ` (+${calls.speedToLeadOver24h})` : ''}`
          : '—'}
      </Num>
      <Num total={total}>{callCell(pct(d.pickupPct))}</Num>
      <Num total={total}>{callCell(pct(d.conversationPct))}</Num>
      <Num total={total}>
        {calls ? (d.dialsPerLead === null ? '—' : d.dialsPerLead.toFixed(1)) : '—'}
      </Num>

      {/* 3. APPOINTMENT DATA */}
      <Num total={total}>{num(row.apptsCreated)}</Num>
      <Num total={total}>{num(row.apptsToBeTaken)}</Num>
      <Num total={total}>{row.lastApptDate ?? '—'}</Num>
      <Num total={total}>{pct(d.schedulePct)}</Num>
      <Num total={total}>{num(row.shows)}</Num>
      <Num total={total}>{num(row.noShows)}</Num>
      <Num total={total}>{num(row.cancels)}</Num>
      <Num total={total}>{num(row.dqs)}</Num>
      <Num total={total}>{pct(d.dqPct)}</Num>
      <Num total={total}>{pct(d.cancelPct)}</Num>
      <Num total={total}>{pct(d.showPct)}</Num>

      {/* 4. DEALS — Revenue and ROI have no Hub source. */}
      <Num total={total}>{num(row.closes)}</Num>
      <Num total={total}>{pct(d.closePct)}</Num>
      <Num total={total}>—</Num>
      <Num total={total}>—</Num>

      {/* 5. KPI METRICS */}
      <Num total={total}>{money(d.costPerBooking)}</Num>
      <Num total={total}>{money(d.costPerShow)}</Num>
      <Num total={total}>{money(d.costPerClose)}</Num>
    </tr>
  );
}

export function StatsDashboardTable({
  rows,
  totals,
  breakdown,
}: {
  rows: DashboardRow[];
  totals: DashboardRow;
  breakdown: Breakdown;
}) {
  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead>
        {/* Sheet row 4. */}
        <tr>
          {SECTIONS.map((section, index) => (
            <th
              key={`${section.label}-${index}`}
              colSpan={section.span}
              /*
               * The first section covers only the frozen Notes column, so it is
               * sticky too — otherwise the section band scrolls away from the
               * column it labels.
               */
              style={index === 0 ? { left: 0, width: FROZEN[0]!.width } : undefined}
              className={cn(
                'sticky top-0 border-b border-line bg-surface-sunken px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-subtle',
                index === 0 && 'z-30',
                index > 0 && 'z-20',
              )}
            >
              {section.label}
            </th>
          ))}
        </tr>
        {/* Sheet row 5. */}
        <tr>
          {HEADINGS.map((heading, index) => {
            const frozen = index < FROZEN.length;
            return (
              <th
                key={heading}
                style={
                  frozen
                    ? {
                        left: LEFT_OFFSETS[index],
                        top: 33,
                        width: FROZEN[index]!.width,
                        minWidth: FROZEN[index]!.width,
                      }
                    : { top: 33 }
                }
                className={cn(
                  'sticky whitespace-nowrap border-b border-line bg-surface px-3 py-2 text-xs font-medium uppercase tracking-wide text-fg-subtle',
                  index < 6 ? 'text-left' : 'text-right',
                  frozen ? 'z-30' : 'z-20',
                )}
              >
                {heading}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Row key={row.key} row={row} breakdown={breakdown} />
        ))}
        <Row row={totals} breakdown={breakdown} total />
      </tbody>
    </table>
  );
}
