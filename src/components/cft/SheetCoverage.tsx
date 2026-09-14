import { FileWarning } from 'lucide-react';

import { formatCount, formatPercent } from '@/lib/format';

export interface CoverageRow {
  clientName: string;
  inSheet: number;
  /** Has a patient name, so somebody could actually add it to the sheet. */
  missingNamed: number;
  /** No patient name. A real CRM record, but nothing anyone can type in. */
  missingUnnamed: number;
  trueTotal: number;
  coverage: number | null;
}

/**
 * How much of the appointment truth the tracker sheet actually holds.
 *
 * Joshua's words: the appointments in GoHighLevel are more accurate than the
 * ones in the sheet. He is right, though the first version of this panel
 * overstated it twice over and he caught both.
 *
 * It counted churned practices with no tracking sheet — Limestone Hills and
 * Metro Dental read as 55 and 46 "missing" when there is no sheet for them to
 * be missing from. Scoped now to practices that have one.
 *
 * And it counted appointments with no patient name. 626 of them fleet-wide are
 * real CRM records with an id and a booked-at, and nothing anybody can go and
 * type into a sheet. Those are shown separately rather than dropped, because
 * 626 nameless appointments is itself worth someone looking at.
 *
 * This sits on the tracker rather than on a page of its own because the tracker
 * is where somebody notices a number looks low and starts doubting the whole
 * thing. The answer to "why is this practice's Schedule % so poor" is often
 * "because half its appointments were never written down", and that belongs
 * next to the figure rather than in a document nobody opens.
 *
 * Sorted by what is missing, not by coverage percent. A practice missing 176
 * appointments matters more than one missing 3, even if the second is a worse
 * percentage — the list is a worklist, so it is ordered by work.
 */
export function SheetCoverage({ rows }: { rows: CoverageRow[] }) {
  const behind = rows.filter((row) => row.missingNamed > 0);
  if (behind.length === 0) return null;

  const missing = behind.reduce((sum, row) => sum + row.missingNamed, 0);
  const unnamed = rows.reduce((sum, row) => sum + row.missingUnnamed, 0);
  const total = rows.reduce((sum, row) => sum + row.trueTotal, 0);
  const held = rows.reduce((sum, row) => sum + row.inSheet, 0);

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <FileWarning size={15} />
          What the sheet is missing
        </h2>
        <p className="numeric text-xs text-fg-subtle">
          {formatCount(held)} of {formatCount(total)} appointments ·{' '}
          {formatPercent(total === 0 ? null : held / total, 1)} coverage
        </p>
      </div>

      <p className="mb-3 max-w-3xl text-xs text-fg-subtle">
        GoHighLevel holds <span className="numeric">{formatCount(total)}</span>{' '}
        appointments and the tracker sheet holds{' '}
        <span className="numeric">{formatCount(held)}</span> of them. The
        relationship is one-directional — no practice has an appointment in the
        sheet that the CRM lacks — so nothing here needs correcting, only{' '}
        <strong className="text-fg-muted">adding</strong>. Only practices with a
        tracking sheet are counted.
        {unnamed > 0 ? (
          <>
            {' '}
            <span className="text-fg-muted">
              A further <span className="numeric">{formatCount(unnamed)}</span>{' '}
              CRM appointments carry no patient name and are not counted above —
              real records, but nothing anybody can type into a sheet.
            </span>
          </>
        ) : null}
      </p>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-xs text-fg-muted">
              <th className="px-4 py-2 font-medium">Practice</th>
              <th className="px-4 py-2 text-right font-medium">To add</th>
              <th className="px-4 py-2 text-right font-medium">In sheet</th>
              <th className="px-4 py-2 text-right font-medium">In GoHighLevel</th>
              <th className="px-4 py-2 text-right font-medium">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {behind.map((row) => (
              <tr
                key={row.clientName}
                className="border-b border-line last:border-0 hover:bg-surface-hover"
              >
                <td className="px-4 py-2 font-medium text-fg">{row.clientName}</td>
                <td className="numeric px-4 py-2 text-right font-medium text-warning">
                  {formatCount(row.missingNamed)}
                </td>
                <td className="numeric px-4 py-2 text-right text-fg-subtle">
                  {row.inSheet === 0 ? (
                    <span className="text-negative">none</span>
                  ) : (
                    formatCount(row.inSheet)
                  )}
                </td>
                <td className="numeric px-4 py-2 text-right text-fg-subtle">
                  {formatCount(row.trueTotal)}
                </td>
                <td className="numeric px-4 py-2 text-right text-fg-muted">
                  {formatPercent(row.coverage, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 max-w-3xl text-xs text-fg-subtle">
        Every figure above the appointment columns — Schedule %, and the lead
        counts it divides by — reads the sheet. Until these are filled in, those
        columns report the sheet&rsquo;s view of the world rather than the world.
        Appointments Created, Shows and the rates built on them already count
        both sources, so they are unaffected.
      </p>
    </section>
  );
}
