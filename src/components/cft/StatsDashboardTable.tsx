import Link from 'next/link';

import { RENDERERS } from '@/components/cft/cells';
import {
  COLUMNS,
  FROZEN_WIDTHS,
  LEFT_OFFSETS,
  SECTIONS,
} from '@/lib/cft-columns';
import { type Breakdown, type DashboardRow, derive } from '@/lib/cft-stats';
import { cn } from '@/lib/cn';

/**
 * The STATS DASHBOARD tab, column for column.
 *
 * Thirty-three columns in the sheet's order under the sheet's six section
 * headers, with each column's sheet letter printed beneath its heading — that
 * letter is the point of the whole page: it is what lets somebody check a cell
 * here against the same cell in the spreadsheet without counting across.
 *
 * The columns themselves live in lib/cft-columns, so a column's letter, its
 * sort value and whether it can be sourced at this grain are one entry rather
 * than three places that can disagree.
 *
 * Frozen columns use position: sticky with explicit left offsets, the pattern
 * already on the client comparison page. The table sets border-separate, not
 * Tailwind's default collapse: collapsed borders are painted by the table
 * rather than the cell, so a sticky cell scrolls out from under its own border
 * and leaves a gap down the frozen edge.
 */
export function StatsDashboardTable({
  rows,
  totals,
  breakdown,
  sort,
  direction,
  hrefForSort,
}: {
  rows: DashboardRow[];
  totals: DashboardRow;
  breakdown: Breakdown;
  /** Index into COLUMNS, or null for the default spend ordering. */
  sort: number | null;
  direction: 'asc' | 'desc';
  hrefForSort: (index: number) => string;
}) {
  const frozen = FROZEN_WIDTHS.length;
  // Once, not once per column: this was being recomputed 33 times a render.
  const totalsDerived = derive(totals);

  return (
    <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
      <thead>
        {/* Sheet row 4. */}
        <tr>
          {SECTIONS.map((section, index) => (
            <th
              key={`${section.label}-${index}`}
              colSpan={section.span}
              /*
                Sections 0 and 1 sit over the frozen columns, so they are pinned
                left as well as top. Without it "CAMPAIGN INFORMATION" scrolls
                away while the columns it labels stay put, and the next section
                slides into its place — the header stops describing what is
                underneath it.
              */
              style={
                index === 0
                  ? { left: 0, width: FROZEN_WIDTHS[0] }
                  : index === 1
                    ? { left: FROZEN_WIDTHS[0] }
                    : undefined
              }
              className={cn(
                'sticky top-0 whitespace-nowrap border-b border-line bg-surface-sunken px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-fg-subtle',
                index <= 1 ? 'z-40' : 'z-30',
                index > 0 && 'border-l border-line',
              )}
            >
              {section.label}
            </th>
          ))}
        </tr>

        {/* Sheet row 5, with the sheet's own letters under each heading. */}
        <tr>
          {COLUMNS.map((column, index) => {
            const isFrozen = index < frozen;
            const sorted = sort === index;

            return (
              <th
                key={column.letter}
                style={{
                  top: 33,
                  ...(isFrozen
                    ? {
                        left: LEFT_OFFSETS[index],
                        width: FROZEN_WIDTHS[index],
                        minWidth: FROZEN_WIDTHS[index],
                      }
                    : { minWidth: 78 }),
                }}
                className={cn(
                  'sticky whitespace-nowrap border-b border-line px-3 py-1.5 align-bottom text-[11px] font-medium uppercase tracking-wide',
                  sorted ? 'bg-accent-subtle text-accent' : 'bg-surface text-fg-subtle',
                  column.align === 'left' ? 'text-left' : 'text-right',
                  isFrozen ? 'z-30' : 'z-20',
                )}
                aria-sort={sorted ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {/*
                  A link, not a button: sorting lives in the URL like every
                  other control on this page, so the table stays server
                  rendered and a sorted view can be sent to somebody.
                */}
                <Link
                  href={hrefForSort(index)}
                  className="block hover:text-fg"
                  scroll={false}
                >
                  {column.heading}
                  {sorted ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}
                  <span className="numeric mt-0.5 block text-[9px] font-normal tracking-widest text-fg-subtle/70">
                    {column.letter}
                  </span>
                </Link>
              </th>
            );
          })}
        </tr>
      </thead>

      <tbody>
        {rows.map((row) => {
          const derived = derive(row);
          return (
            <tr key={row.key} className="group">
              {COLUMNS.map((column, index) => (
                <Cell
                  key={column.letter}
                  index={index}
                  breakdown={breakdown}
                  body={RENDERERS[column.letter]?.(row, derived) ?? null}
                  column={column}
                />
              ))}
            </tr>
          );
        })}
      </tbody>

      <tfoot>
        <tr>
          {COLUMNS.map((column, index) => {
            const isFrozen = index < frozen;
            const blocked = column.blockedAt?.(breakdown) ?? false;

            return (
              <td
                key={column.letter}
                style={
                  isFrozen
                    ? {
                        left: LEFT_OFFSETS[index],
                        width: FROZEN_WIDTHS[index],
                        minWidth: FROZEN_WIDTHS[index],
                      }
                    : undefined
                }
                className={cn(
                  'numeric whitespace-nowrap border-t-2 border-line-strong bg-surface-sunken px-3 py-2 font-semibold text-fg',
                  column.align === 'left' ? 'text-left' : 'text-right',
                  isFrozen && 'sticky z-10',
                )}
              >
                {/* The label sits in Client Name, where the eye already is. */}
                {index === 2
                  ? 'Total'
                  : blocked || column.noSource || index < 2 || (index > 2 && index < 6)
                    ? null
                    : (RENDERERS[column.letter]?.(totals, totalsDerived) ?? null)}
              </td>
            );
          })}
        </tr>
      </tfoot>
    </table>
  );
}

function Cell({
  index,
  breakdown,
  body,
  column,
}: {
  index: number;
  breakdown: Breakdown;
  body: React.ReactNode;
  column: (typeof COLUMNS)[number];
}) {
  const isFrozen = index < FROZEN_WIDTHS.length;
  const blocked = column.blockedAt?.(breakdown) ?? false;

  return (
    <td
      style={
        isFrozen
          ? {
              left: LEFT_OFFSETS[index],
              width: FROZEN_WIDTHS[index],
              minWidth: FROZEN_WIDTHS[index],
            }
          : undefined
      }
      className={cn(
        'numeric overflow-hidden text-ellipsis whitespace-nowrap border-b border-line px-3 py-1.5',
        column.align === 'left' ? 'text-left' : 'text-right',
        isFrozen
          ? 'sticky z-10 bg-surface font-medium text-fg'
          : 'bg-surface text-fg-muted',
        // Hatched, not blank. A blank cell reads as zero or as nobody having
        // filled it in; hatching reads as "cannot be known at this grain",
        // which is what the legend below the table explains.
        blocked && 'cft-blocked',
      )}
    >
      {blocked ? null : body}
    </td>
  );
}
