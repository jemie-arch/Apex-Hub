/**
 * GoHighLevel locations -> client_groups + clients.
 *
 * Idempotent by crm_location_id: re-running matches the same row every time.
 *
 * On grouping: a new location gets its OWN business record. It does not get
 * merged into an existing one, even when the names look similar — a practice
 * running three sub-accounts and three unrelated practices with similar names
 * are indistinguishable from here, and merging the wrong pair would file one
 * practice's revenue under another. Merging is a deliberate human action.
 *
 * Who owns what:
 *   the CRM owns   location name, timezone, contact details (never nulled out)
 *   a human owns   status, onboarding stage, retainer, treatments, signed_on,
 *                  and which business a location belongs to
 *
 * The second list is the whole reason this app exists, so the sync must never
 * touch it once set.
 */
import type { ClientGroupRow, ClientRow } from '@/types/database';

import { listLocations } from '@/lib/integrations/ghl';
import { authoritative, humanOwned, isNoop } from '@/lib/sync/merge';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base === '' ? 'client' : base;
}

function uniqueSlug(name: string, taken: Set<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not find a free slug for "${name}"`);
}

export async function syncCrmClients(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  const locations = await listLocations();
  ctx.counts.read = locations.length;
  ctx.log(`${locations.length} location(s) from GoHighLevel`);

  const [existingClients, existingGroups] = await Promise.all([
    db.from('clients').select('*').not('crm_location_id', 'is', null),
    db.from('client_groups').select('*'),
  ]);
  if (existingClients.error) throw existingClients.error;
  if (existingGroups.error) throw existingGroups.error;

  const clientByLocation = new Map<string, ClientRow>();
  for (const row of existingClients.data ?? []) {
    if (row.crm_location_id) clientByLocation.set(row.crm_location_id, row);
  }

  const groupById = new Map<string, ClientGroupRow>();
  for (const row of existingGroups.data ?? []) groupById.set(row.id, row);

  const takenGroupSlugs = new Set(
    (existingGroups.data ?? []).map((row) => row.slug),
  );
  const takenClientSlugs = new Set(
    (existingClients.data ?? []).map((row) => row.slug),
  );

  let created = 0;

  for (const location of locations) {
    const current = clientByLocation.get(location.id);

    if (!current) {
      // One business per new location. A human merges later if this practice
      // turns out to run several sub-accounts.
      const group = await db
        .from('client_groups')
        .insert({
          name: location.name,
          slug: uniqueSlug(location.name, takenGroupSlugs),
          status: 'onboarding',
          ...(location.email ? { contact_email: location.email } : {}),
          ...(location.phone ? { contact_phone: location.phone } : {}),
          ...(location.website ? { website: location.website } : {}),
        })
        .select('id')
        .maybeSingle();

      if (group.error || !group.data) {
        ctx.recordError(`could not create a business for "${location.name}"`, {
          locationId: location.id,
          detail: group.error?.message,
        });
        continue;
      }

      const client = await db.from('clients').insert({
        group_id: group.data.id,
        name: location.name,
        slug: uniqueSlug(location.name, takenClientSlugs),
        crm_location_id: location.id,
        ...(location.timezone ? { timezone: location.timezone } : {}),
      });

      if (client.error) {
        ctx.recordError(`could not create a location for "${location.name}"`, {
          locationId: location.id,
          detail: client.error.message,
        });
        continue;
      }

      ctx.counts.created += 1;
      created += 1;
      continue;
    }

    // Update the sub-account. The CRM is the source of truth for these, but a
    // null never lands.
    const clientPatch: Partial<ClientRow> = authoritative<ClientRow>(
      {
        name: location.name,
        ...(location.timezone ? { timezone: location.timezone } : {}),
      },
      ['name', 'timezone'],
    );

    if (Object.keys(clientPatch).length > 0 && !isNoop(current, clientPatch)) {
      const update = await db
        .from('clients')
        .update(clientPatch)
        .eq('id', current.id);

      if (update.error) {
        ctx.recordError(`could not update location "${current.name}"`, {
          clientId: current.id,
          detail: update.error.message,
        });
        continue;
      }
      ctx.counts.updated += 1;
    } else {
      ctx.counts.skipped += 1;
    }

    // Fill blank contact details on the business; a human's correction stands.
    const group = groupById.get(current.group_id);
    if (!group) continue;

    const groupPatch = humanOwned<ClientGroupRow>(
      group,
      {
        contact_email: location.email,
        contact_phone: location.phone,
        website: location.website,
      },
      ['contact_email', 'contact_phone', 'website'],
    );

    if (Object.keys(groupPatch).length > 0) {
      const update = await db
        .from('client_groups')
        .update(groupPatch)
        .eq('id', group.id);
      if (update.error) {
        ctx.recordError(`could not update business "${group.name}"`, {
          groupId: group.id,
          detail: update.error.message,
        });
      }
    }
  }

  if (created > 0) {
    ctx.log(
      `${created} new location(s) each created their own business record. ` +
        'Merge any that belong to the same practice by hand.',
    );
  }

  /*
   * Bring client_groups.status back in line with the evidence.
   *
   * The column used to be written once, when the row was created, and never
   * again: 64 of 73 businesses read 'onboarding' and none read 'active',
   * including practices that had been booking consultations for a year. The
   * dashboard's client count was wrong for as long as that was true.
   *
   * refresh_client_statuses() decides it from live sub-accounts plus a booking,
   * a charge or ad spend in the last 90 days, and leaves 'churned' and 'paused'
   * alone, because those are somebody's decision rather than an observation.
   * Running it here means the answer is never older than the last sync.
   */
  const refreshed = await db.rpc('refresh_client_statuses');

  if (refreshed.error) {
    ctx.recordError('could not refresh client statuses', {
      detail: refreshed.error.message,
    });
  } else if ((refreshed.data ?? 0) > 0) {
    ctx.log(`${refreshed.data} business(es) changed status.`);
  }
}
