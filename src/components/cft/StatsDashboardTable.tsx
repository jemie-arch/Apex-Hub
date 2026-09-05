'use client';

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
/*
 * The group row's height, fixed and shared.
 *
 * Both header rows are sticky, so the second has to be offset by exactly the
 * height of the first. That offset was hardcoded at 33px against a row whose
 * real height was set by its padding and line-height — so the second row sat
 * slightly wrong and the first data row scrolled up underneath it, clipped in
 * half. Pinning the height here and reading it in both places means the two
 * cannot drift again.
 */
const GROUP_ROW_HEIGHT = 30;

export function StatsDashboardTable({
  rows,
  totals,
  breakdown,
  sort,
  direction,
  sortHrefs,
  selectedKey,
  onSelect,
}: {
  rows: DashboardRow[];
  totals: DashboardRow;
  breakdown: Breakdown;
  /** Index into COLUMNS, or null for the default spend ordering. */
  sort: number | null;
  direction: 'asc' | 'desc';
  /*
   * Built on the server and handed over as strings, one per column. This is a
   * client component, and a builder function cannot cross that boundary —
   * FilterPillLinks records the render-time error that taught the codebase so.
   */
  sortHrefs: string[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
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
                Pinned to the top only, never to the left.
                
                An earlier version pinned the first two sections leftwards so
                they would stay with the frozen columns. They did — and because
                "CAMPAIGN INFORMATION" spans five columns, its band came with
                them and sat on top of "1. AD DATA" and "2. CALL DATA", hiding
                both. A band that spans a range cannot be pinned to a point.
                
                So the section row scrolls with its columns. The cost is that
                the leftmost section label leaves the screen when you scroll
                right; the alternative was a label covering two others, which
                is worse than a label that is absent.
              */
              style={{ height: GROUP_ROW_HEIGHT }}
              className={cn(
                'sticky top-0 z-20 whitespace-nowrap border-b border-line bg-surface-sunken px-2 py-0 text-left text-[10px] font-semibold uppercase tracking-widest text-fg-subtle',
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
                  top: GROUP_ROW_HEIGHT,
                  ...(isFrozen
                    ? {
                        left: LEFT_OFFSETS[index],
                        width: FROZEN_WIDTHS[index],
                        minWidth: FROZEN_WIDTHS[index],
                      }
                    : { minWidth: 68, maxWidth: column.maxWidth ?? 108 }),
                }}
                className={cn(
                  'group/th sticky border-b border-line px-2 py-1.5 align-bottom text-[10px] font-medium uppercase leading-tight tracking-wide',
                  isFrozen && 'whitespace-nowrap',
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
                  href={sortHrefs[index] ?? '#'}
                  className="block hover:text-fg"
                  scroll={false}
                >
                  {column.heading}
                  <span
                    aria-hidden
                    className={cn(
                      'ml-1',
                      sorted ? 'text-accent' : 'text-fg-subtle/40 group-hover/th:text-fg-subtle',
                    )}
                  >
                    {sorted ? (direction === 'asc' ? '↑' : '↓') : '↕'}
                  </span>
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
            <tr
              key={row.key}
              onClick={() => onSelect(row.key)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(row.key);
                }
              }}
              className={cn(
                'row-interactive cursor-pointer focus:outline-none',
                row.key === selectedKey && 'cft-selected',
              )}
            >
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
                        maxWidth: FROZEN_WIDTHS[index],
                      }
                    : column.maxWidth
                      ? { maxWidth: column.maxWidth }
                      : undefined
                }
                className={cn(
                  'numeric overflow-hidden text-ellipsis whitespace-nowrap border-t-2 border-line-strong bg-surface-sunken px-2 py-1.5 font-semibold text-fg',
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
              maxWidth: FROZEN_WIDTHS[index],
            }
          : column.maxWidth
            ? { maxWidth: column.maxWidth }
            : undefined
      }
      className={cn(
        'numeric overflow-hidden text-ellipsis whitespace-nowrap border-b border-line px-2 py-1',
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
