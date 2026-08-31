'use server';

/**
 * Confirming which sheet a clinic's bookings belong in.
 *
 * This is the most consequential confirmation on the Settings screens, and it is
 * deliberately a human act. The rows arrive derived from a name match, and a
 * name match in this population is not trustworthy on its own: the first
 * attempt at scoring these scored "Cruz Orthodontics" against "Ofir
 * Orthodontics" high enough to auto-accept. Verifying is the step that says a
 * person opened the sheet and it was the right practice.
 *
 * What verification unlocks is real: pps_routing_export only publishes verified
 * rows, and the consolidated Make scenario reads that. So pressing verify puts
 * a live booking on that path.
 */
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export interface RoutingResult {
  ok: boolean;
  message: string;
}

/** A Google file id: 40-plus of the URL-safe alphabet, nothing else. */
const SHEET_ID = /^[A-Za-z0-9_-]{20,}$/;

function revalidate(): void {
  revalidatePath('/settings/clinic-routing');
  revalidatePath('/reconciliation');
}

/**
 * Set or clear the sheet for a clinic.
 *
 * Clearing is allowed and does not delete the row: a clinic whose sheet is
 * unknown should stay visible as a gap rather than disappear from the list,
 * because a missing row is how a practice goes quietly unrouted.
 *
 * Setting a sheet always drops verification. The point of verification is that
 * somebody checked this exact id, so changing the id has to invalidate it —
 * carrying the tick over would let an unchecked sheet inherit a checked one's
 * authority.
 */
export async function setRoutingSheet(input: {
  clientId: string;
  sheetId: string;
}): Promise<RoutingResult> {
  await requireAdmin();

  const db = serviceClient();
  const raw = input.sheetId.trim();

  if (raw === '') {
    const cleared = await db
      .from('pps_clinic_routing')
      .update({
        spreadsheet_id: null,
        verified_at: null,
        verified_by: null,
        source: 'manual',
        updated_at: new Date().toISOString(),
      })
      .eq('client_id', input.clientId);

    if (cleared.error) return { ok: false, message: cleared.error.message };
    revalidate();
    return { ok: true, message: 'Cleared, and this clinic is now a gap.' };
  }

  /*
   * Accept a pasted URL as well as a bare id, because the natural thing to do
   * is copy the address bar. Taking the /d/<id>/ segment is what a person means
   * by "this sheet".
   */
  const fromUrl = raw.match(/\/d\/([A-Za-z0-9_-]+)/);
  const sheetId = fromUrl ? fromUrl[1]! : raw;

  if (!SHEET_ID.test(sheetId)) {
    return {
      ok: false,
      message:
        'That does not look like a Google Sheet id. Paste the sheet URL or the ' +
        'id from it.',
    };
  }

  /*
   * Refuse a sheet another clinic already claims. Two clinics pointing at one
   * file is the fault this whole table exists to retire — pps_routing_export
   * would exclude both, so allowing it here would silently unroute the clinic
   * that was already working.
   */
  const taken = await db
    .from('pps_clinic_routing')
    .select('practice')
    .eq('spreadsheet_id', sheetId)
    .neq('client_id', input.clientId)
    .maybeSingle();

  if (taken.error) return { ok: false, message: taken.error.message };
  if (taken.data) {
    return {
      ok: false,
      message:
        `${taken.data.practice} already routes to that sheet. Two clinics ` +
        'sharing one file is the problem this replaces — clear it there first, ' +
        'or check which practice actually owns the file.',
    };
  }

  const written = await db
    .from('pps_clinic_routing')
    .update({
      spreadsheet_id: sheetId,
      // Changing the id invalidates any previous check, by design.
      verified_at: null,
      verified_by: null,
      source: 'manual',
      updated_at: new Date().toISOString(),
    })
    .eq('client_id', input.clientId);

  if (written.error) return { ok: false, message: written.error.message };

  revalidate();
  return {
    ok: true,
    message: 'Saved. Still needs verifying before it goes into use.',
  };
}

/** Mark a clinic's sheet as checked, which is what puts it into use. */
export async function verifyRouting(input: {
  clientId: string;
}): Promise<RoutingResult> {
  const caller = await requireAdmin();

  const db = serviceClient();

  const row = await db
    .from('pps_clinic_routing')
    .select('practice, spreadsheet_id')
    .eq('client_id', input.clientId)
    .maybeSingle();

  if (row.error) return { ok: false, message: row.error.message };
  if (!row.data) return { ok: false, message: 'No routing row for that clinic.' };

  if (!row.data.spreadsheet_id) {
    return {
      ok: false,
      message:
        'There is no sheet to verify. Set one first — verifying an empty row ' +
        'would publish a clinic with nowhere to write.',
    };
  }

  const written = await db
    .from('pps_clinic_routing')
    .update({
      verified_at: new Date().toISOString(),
      verified_by: caller.id,
      updated_at: new Date().toISOString(),
    })
    .eq('client_id', input.clientId);

  if (written.error) return { ok: false, message: written.error.message };

  revalidate();
  return {
    ok: true,
    message: `${row.data.practice} will be published on the next routing export.`,
  };
}

/**
 * Withdraw a clinic from the automation.
 *
 * Kept as a first-class action rather than something to do in the database,
 * because the moment somebody suspects a sheet is wrong they need to stop
 * bookings going there without waiting for anybody.
 */
export async function unverifyRouting(input: {
  clientId: string;
}): Promise<RoutingResult> {
  await requireAdmin();

  const db = serviceClient();

  const written = await db
    .from('pps_clinic_routing')
    .update({
      verified_at: null,
      verified_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('client_id', input.clientId);

  if (written.error) return { ok: false, message: written.error.message };

  revalidate();
  return {
    ok: true,
    message:
      'Withdrawn. The next routing export removes it from the store, so run ' +
      'that sync if this is urgent.',
  };
}
