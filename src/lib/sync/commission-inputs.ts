/**
 * Read the commission scheme from the sheet that owns it.
 *
 * Its own sync rather than a step inside the tracker import, because it is a
 * different spreadsheet with a different owner. Folded in, one missing
 * credential or one renamed tab would take both down, and the 1,300 consultation
 * records matter more than a rate.
 *
 * WHAT IT FOUND, AND WHY IT MATTERS
 *
 * The scheme is two separate payments, which resolves a question the tiers alone
 * could not answer:
 *
 *   COMMISSION is per booking, at a rate that steps with monthly volume — $8
 *   each below 96 bookings, $10 below 128, $12 above. So an ISA with 75 bookings
 *   earns 75 x $8. This is what a "commission unit" is: one booking.
 *
 *   THE DAILY BONUS is separate — $10 at five bookings in a day, $20 at six,
 *   $30 at eight — and does not scale with the commission rate at all.
 *
 * That is why units x rate could never reconcile with the tier table: they were
 * never the same payment.
 *
 * Read-only, and it writes no money. It stores the figures and reports what it
 * saw; the calculation is applied in lib/isa-commission.
 */
import {
  COMMISSION_INPUT_RANGE,
  INPUT_LABELS,
  MONEY_FIELDS,
  normaliseLabel,
} from '@/config/commission-inputs';
import { serverEnv } from '@/lib/env';
import { listSheetTitles, readSheet } from '@/lib/integrations/google-sheets';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/**
 * A number a person typed into a spreadsheet, or null.
 *
 * Strict about what it accepts. Coercing a label to zero is the failure this
 * whole module was rewritten to avoid: the rate was first read from the
 * tracker's INPUT CLIENT INFO!B12, which holds the client name "Dental
 * Illusions", and stripping non-digits from that gives a rate of zero — which
 * pays nobody while every other part of the calculation keeps working.
 */
function asNumber(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return null;

  // Currency and thousands separators are expected; letters are not.
  const cleaned = trimmed.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export async function syncCommissionInputs(ctx: SyncContext): Promise<void> {
  const sheetId = serverEnv().COMMISSION_INPUTS_SHEET_ID;

  if (!sheetId) {
    ctx.recordError(
      'COMMISSION_INPUTS_SHEET_ID is not set, so the commission scheme cannot ' +
        'be read. It is the "Apex - Call Center Agent Dashboard" spreadsheet — a ' +
        'different file from the fulfilment tracker.',
    );
    return;
  }

  let rows: string[][];
  try {
    rows = await readSheet(sheetId, COMMISSION_INPUT_RANGE);
  } catch (error) {
    /*
     * A wrong tab name returns a bare 400 naming neither the tab nor the
     * mistake, so the real titles go into the error. The tab is INPUT VALUES in
     * capitals, and A1 notation is not forgiving about it.
     */
    let tabs: string[] = [];
    try {
      tabs = await listSheetTitles(sheetId);
    } catch {
      // Already failing; the tab list is a courtesy, not a second attempt.
    }
    ctx.recordError(
      `Could not read ${COMMISSION_INPUT_RANGE}: ` +
        `${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
      { tabs },
    );
    return;
  }

  ctx.counts.read = rows.length;

  const found = new Map<string, number>();
  const unrecognised: string[] = [];

  for (const row of rows) {
    const label = normaliseLabel(row[0] ?? '');
    if (label === '') continue;

    const field = INPUT_LABELS[label];
    const value = asNumber(row[1]);

    if (field === undefined) {
      // Only worth reporting when there was a number beside it: a section
      // header like "Daily Bonus" is not a missing setting.
      if (value !== null) unrecognised.push(`${(row[0] ?? '').trim()} = ${row[1]}`);
      continue;
    }

    if (value === null) {
      ctx.recordError(
        `"${(row[0] ?? '').trim()}" is a rate this scheme needs, but its value ` +
          `reads "${row[1] ?? ''}" rather than a number. Nothing is stored, so ` +
          'the previous figures stand.',
        { field },
      );
      return;
    }

    // First occurrence wins, matching the tracker's header rule.
    if (!found.has(field)) found.set(field, value);
  }

  const missing = [...new Set(Object.values(INPUT_LABELS))].filter(
    (field) => !found.has(field),
  );

  if (missing.length > 0) {
    /*
     * All or nothing. A scheme half-read is worse than one not read: the stored
     * figures would be a mix of two versions, and nothing downstream could tell.
     */
    ctx.recordError(
      `The commission scheme is missing ${missing.length} figure(s): ` +
        `${missing.join(', ')}. Labels actually present are listed in the ` +
        'notes. Nothing was stored.',
      { missing },
    );
    ctx.note('labels_unrecognised', unrecognised);
    return;
  }

  // Money in cents, counts as counts. Mixing the two is how a $8 rate becomes
  // eight cents or an eight-booking threshold becomes eight hundred.
  const scheme: Record<string, number> = {};
  for (const [field, value] of found) {
    scheme[field] = MONEY_FIELDS.includes(field) ? Math.round(value * 100) : value;
  }

  const written = await serviceClient().from('app_settings').upsert(
    {
      key: 'isa_commission_scheme',
      value: scheme,
      description:
        `Read from ${COMMISSION_INPUT_RANGE} of the Call Center Agent ` +
        'Dashboard. Money is in cents; thresholds are booking counts. Change ' +
        'these in the sheet, not here — the next run overwrites them.',
    },
    { onConflict: 'key' },
  );

  if (written.error) {
    ctx.recordError(`Could not store the scheme: ${written.error.message}`);
    return;
  }

  ctx.counts.updated = 1;

  // The figures themselves, so a change in pay has a dated record of what the
  // sheet said at the time rather than only what it says now.
  ctx.note('scheme', scheme);
  if (unrecognised.length > 0) ctx.note('labels_unrecognised', unrecognised);

  ctx.log(
    `Commission scheme read: $${(scheme['unitAmount']! / 100).toFixed(2)} per ` +
      `booking below ${scheme['quota1Threshold']}, ` +
      `$${(scheme['quota1Amount']! / 100).toFixed(2)} below ` +
      `${scheme['quota2Threshold']}, then ` +
      `$${(scheme['quota2Amount']! / 100).toFixed(2)}. Daily bonus ` +
      `$${(scheme['tier1Bonus']! / 100).toFixed(2)}/` +
      `$${(scheme['tier2Bonus']! / 100).toFixed(2)}/` +
      `$${(scheme['tier3Bonus']! / 100).toFixed(2)} at ` +
      `${scheme['tier1Threshold']}/${scheme['tier2Threshold']}/` +
      `${scheme['tier3Threshold']} bookings. ` +
      `${scheme['bookingsLostPerInvalid']} booking(s) lost per invalid booking.`,
  );
}
