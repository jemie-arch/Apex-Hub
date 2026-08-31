/**
 * Publishes verified clinic routing to Make, so no scenario has to name a sheet.
 *
 * This is the half of the system that removes the fault rather than reporting
 * it. Today the spreadsheet id lives inside 56 cloned scenarios, up to eight
 * times each; every clone is a chance to paste the wrong one, and Make's own
 * interface gives nobody a way to notice. Once the id comes from a lookup keyed
 * on the location id the webhook already carries, there is no per-practice
 * configuration left to get wrong, and adding a practice is a row rather than a
 * clone.
 *
 * Three rules it will not break.
 *
 * It publishes only verified rows. pps_routing_export already filters on that;
 * this sync does not second-guess it or add a fallback. An unverified guess
 * reaching the automation would route a real patient into the wrong practice's
 * sheet, which is worse than the problem being fixed.
 *
 * It reconciles rather than appends. What ends up in the store is what the Hub
 * publishes — no more, so a withdrawn clinic stops being routed.
 *
 * It refuses to empty the store. A run that would delete everything is treated
 * as a bug in this code or a broken query, never as an instruction, because the
 * consolidated scenario reads this store and an empty one silently stops routing
 * every clinic at once.
 */
import {
  currentRecords,
  deleteRecords,
  putRecord,
} from '@/lib/integrations/make-routing';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

export async function syncRoutingExport(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  const wanted = await db
    .from('pps_routing_export')
    .select('crm_location_id, spreadsheet_id, practice');
  if (wanted.error) throw wanted.error;

  const rows = (wanted.data ?? []).flatMap((row) =>
    row.crm_location_id && row.spreadsheet_id
      ? [
          {
            locationId: row.crm_location_id,
            spreadsheetId: row.spreadsheet_id,
            practice: row.practice ?? '',
          },
        ]
      : [],
  );

  ctx.counts.read = rows.length;
  ctx.note('verified_clinics', rows.length);

  /*
   * Report the gaps every run, because this number is the actual measure of how
   * far the consolidated scenario is from replacing the clones. A sync that only
   * said "published 9" would look like progress while 56 practices stayed on the
   * old path.
   */
  const gaps = await db
    .from('pps_routing_gaps')
    .select('practice, gap');
  if (!gaps.error) {
    const unrouted = gaps.data ?? [];
    ctx.note('clinics_not_routable', unrouted.length);
    if (unrouted.length > 0) {
      ctx.log(
        `${unrouted.length} active clinic(s) cannot be routed yet. The ` +
          'consolidated scenario cannot replace the per-practice clones until ' +
          'this reaches zero: ' +
          unrouted
            .slice(0, 12)
            .map((g) => `${g.practice} — ${g.gap}`)
            .join('; ') +
          (unrouted.length > 12 ? `; and ${unrouted.length - 12} more` : ''),
      );
    }
  }

  const existing = await currentRecords();
  ctx.note('records_in_store', existing.size);

  if (rows.length === 0) {
    /*
     * Nothing verified yet is the expected state on the first run, not a
     * failure — but it must not be mistaken for "done". Raised as an error
     * rather than logged precisely because a silent no-op here looks identical
     * to a working sync.
     */
    ctx.recordError(
      'No clinic routing is verified, so nothing was published and the store ' +
        'was left exactly as it was. Verify the derived rows in ' +
        'pps_clinic_routing first — they are deliberately inert until somebody ' +
        'confirms the sheet belongs to the practice.',
      { recordsAlreadyInStore: existing.size },
    );
    return;
  }

  const stale = [...existing.keys()].filter(
    (key) => !rows.some((row) => row.locationId === key),
  );

  /*
   * The guard. If a query regression made pps_routing_export return a handful of
   * rows, a blind reconcile would delete the rest and every clinic it dropped
   * would stop being routed with no error anywhere. Deleting more than half the
   * store is not a legitimate day's change.
   */
  if (existing.size > 0 && stale.length > existing.size / 2) {
    ctx.recordError(
      `Refusing to publish: this run would remove ${stale.length} of ` +
        `${existing.size} routing records, which is more than half the store. ` +
        'That is a broken query far more often than it is a real change. ' +
        'Nothing was written; check pps_routing_export before retrying.',
      { wouldDelete: stale.length, inStore: existing.size },
    );
    return;
  }

  let written = 0;
  let unchanged = 0;

  for (const row of rows) {
    const before = existing.get(row.locationId);
    if (
      before &&
      before.spreadsheetId === row.spreadsheetId &&
      before.practice === row.practice
    ) {
      unchanged += 1;
      continue;
    }

    try {
      await putRecord(row);
      written += 1;
    } catch (error) {
      /*
       * One clinic failing must not stop the rest. Named, because "a record
       * failed" cannot be acted on and "Bespoke Orthodontics failed" can.
       */
      ctx.recordError(
        `Could not publish routing for ${row.practice || row.locationId}, so ` +
          'that clinic keeps whatever the store held before.',
        {
          locationId: row.locationId,
          detail: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  if (stale.length > 0) {
    try {
      await deleteRecords(stale);
      ctx.note('records_removed', stale.length);
    } catch (error) {
      ctx.recordError(
        'Published the current clinics, but could not remove ' +
          `${stale.length} withdrawn one(s), so the store may still route a ` +
          'clinic the Hub no longer publishes.',
        {
          keys: stale,
          detail: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  ctx.counts.updated = written;
  ctx.note('records_written', written);
  ctx.note('records_unchanged', unchanged);
}
