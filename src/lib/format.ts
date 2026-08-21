/**
 * Formatting. Two rules that the rest of the app depends on:
 *
 *   1. Money is stored in cents and only ever becomes a decimal here.
 *   2. A timestamp renders in the CLIENT's timezone, never the viewer's. A 9am
 *      booking is 9am where the client is, whoever is looking at the screen.
 */
import { formatInTimeZone } from 'date-fns-tz';

import { tenant } from '@/config/tenant.config';

export function formatMoney(
  cents: number | null | undefined,
  currency: string = tenant.defaultCurrency,
): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** For the hero tile and anywhere a long number would wrap. */
export function formatMoneyCompact(
  cents: number | null | undefined,
  currency: string = tenant.defaultCurrency,
): string {
  if (cents === null || cents === undefined) return '—';
  const value = cents / 100;
  if (Math.abs(value) < 10_000) return formatMoney(cents, currency);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat().format(value);
}

/** `rate` is a fraction: 0.42 renders as 42%. */
export function formatPercent(
  rate: number | null | undefined,
  fractionDigits = 0,
): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(rate);
}

export function formatMultiple(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(2)}×`;
}

/**
 * Percentage change between two periods, as a fraction. Null when there is no
 * baseline — an increase from zero is not "infinite growth", it is unmeasurable.
 */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** A booking time, in the client's zone. */
export function formatDateTimeInZone(
  iso: string | null | undefined,
  timezone: string,
  pattern = 'd MMM yyyy, HH:mm',
): string {
  if (!iso) return '—';
  return formatInTimeZone(new Date(iso), timezone, pattern);
}

export function formatDateInZone(
  iso: string | null | undefined,
  timezone: string,
  pattern = 'd MMM yyyy',
): string {
  if (!iso) return '—';
  return formatInTimeZone(new Date(iso), timezone, pattern);
}

/** Short zone label to sit next to a time, e.g. "AEST". */
export function zoneAbbreviation(timezone: string, at: Date = new Date()): string {
  return formatInTimeZone(at, timezone, 'zzz');
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

/** Turns an enum value into something readable: 'no_show' -> 'No show'. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
