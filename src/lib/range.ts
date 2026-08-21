/**
 * Date ranges live in the URL, so every page is shareable and a server
 * component can read the range without client state.
 *
 * Range boundaries are resolved in UTC. Cross-client pages compare clients in
 * many zones, and a shifting boundary per viewer would make two people reading
 * the same URL see different totals. Individual timestamps still render in the
 * client's zone — see formatDateTimeInZone.
 */
import {
  differenceInCalendarDays,
  endOfMonth,
  endOfQuarter,
  endOfYear,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
  subMonths,
} from 'date-fns';

export type PresetKey =
  | 'this_month'
  | 'last_month'
  | 'last_7'
  | 'last_30'
  | 'last_90'
  | 'this_quarter'
  | 'this_year'
  | 'custom';

export const PRESETS: ReadonlyArray<{ key: PresetKey; label: string }> = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_7', label: 'Last 7 days' },
  { key: 'last_30', label: 'Last 30 days' },
  { key: 'last_90', label: 'Last 90 days' },
  { key: 'this_quarter', label: 'This quarter' },
  { key: 'this_year', label: 'This year' },
];

export interface DateRange {
  from: Date;
  to: Date;
  label: string;
  preset: PresetKey;
  /** Equal-length window immediately before, for period-on-period deltas. */
  previous: { from: Date; to: Date };
}

export interface RangeParams {
  preset?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

function previousOf(from: Date, to: Date): { from: Date; to: Date } {
  const days = Math.max(1, differenceInCalendarDays(to, from) + 1);
  return { from: subDays(from, days), to: subDays(to, days) };
}

function labelFor(preset: PresetKey): string {
  return PRESETS.find((entry) => entry.key === preset)?.label ?? 'Custom range';
}

/** Never throws: a malformed URL falls back to the current month. */
export function resolveRange(params: RangeParams, now: Date = new Date()): DateRange {
  const preset = (params.preset ?? 'this_month') as PresetKey;

  if (preset === 'custom' && params.from && params.to) {
    const from = new Date(`${params.from}T00:00:00.000Z`);
    const to = new Date(`${params.to}T23:59:59.999Z`);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
      return {
        from,
        to,
        preset: 'custom',
        label: 'Custom range',
        previous: previousOf(from, to),
      };
    }
  }

  let from: Date;
  let to: Date;

  switch (preset) {
    case 'last_month': {
      const anchor = subMonths(now, 1);
      from = startOfMonth(anchor);
      to = endOfMonth(anchor);
      break;
    }
    case 'last_7':
      from = subDays(now, 6);
      to = now;
      break;
    case 'last_30':
      from = subDays(now, 29);
      to = now;
      break;
    case 'last_90':
      from = subDays(now, 89);
      to = now;
      break;
    case 'this_quarter':
      from = startOfQuarter(now);
      to = endOfQuarter(now);
      break;
    case 'this_year':
      from = startOfYear(now);
      to = endOfYear(now);
      break;
    case 'this_month':
    default:
      from = startOfMonth(now);
      to = endOfMonth(now);
      break;
  }

  const resolved: PresetKey = PRESETS.some((entry) => entry.key === preset)
    ? preset
    : 'this_month';

  return {
    from,
    to,
    preset: resolved,
    label: labelFor(resolved),
    previous: previousOf(from, to),
  };
}

/** Postgres-friendly ISO bounds. */
export function bounds(from: Date, to: Date): { start: string; end: string } {
  return { start: from.toISOString(), end: to.toISOString() };
}

/** Date-only bounds, for the date columns on ad_snapshots. */
export function dateBounds(from: Date, to: Date): { start: string; end: string } {
  return {
    start: from.toISOString().slice(0, 10),
    end: to.toISOString().slice(0, 10),
  };
}
