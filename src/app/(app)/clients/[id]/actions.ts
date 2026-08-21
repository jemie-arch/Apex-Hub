'use server';

/**
 * Editing a business and its sub-accounts.
 *
 * These are the fields the syncs deliberately never touch — status, retainer,
 * signed_on, ad_account_id — so this is the only way they get set. Until now
 * they needed raw SQL, which meant the ads sync had nothing to work with and
 * the client target had no signing dates to count.
 *
 * Admin-only, checked here: a server action is its own POST endpoint, and
 * middleware guarding the page that renders the form does not protect it.
 */
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import type { ClientStatus } from '@/types/database';

export interface SaveResult {
  ok: boolean;
  message: string;
}

const STATUSES: readonly ClientStatus[] = [
  'onboarding',
  'active',
  'paused',
  'churned',
];

/** Money as typed ("2,500" or "2500.00") to integer cents. */
function toCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (cleaned === '') return 0;

  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/** Empty string means "clear it"; a date must actually be a date. */
function toDateOrNull(raw: string): string | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return trimmed;
}

function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export async function updateClientGroup(input: {
  groupId: string;
  name: string;
  status: string;
  onboardingStage: string;
  retainer: string;
  currency: string;
  treatments: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  signedOn: string;
  startedOn: string;
  portalEnabled: boolean;
}): Promise<SaveResult> {
  await requireAdmin();

  const name = input.name.trim();
  if (name === '') return { ok: false, message: 'Name cannot be empty.' };

  if (!STATUSES.includes(input.status as ClientStatus)) {
    return { ok: false, message: 'Unrecognised status.' };
  }
  const status = input.status as ClientStatus;

  const retainerCents = toCents(input.retainer);
  if (retainerCents === null) {
    return { ok: false, message: 'Retainer must be zero or more.' };
  }

  const signedOn = toDateOrNull(input.signedOn);
  const startedOn = toDateOrNull(input.startedOn);
  if (signedOn === undefined || startedOn === undefined) {
    return { ok: false, message: 'Dates must be YYYY-MM-DD.' };
  }

  // The schema requires a churn date whenever status is churned, so fill it
  // rather than letting the constraint reject the write with a raw error.
  const today = new Date().toISOString().slice(0, 10);
  const existing = await serviceClient()
    .from('client_groups')
    .select('churned_on')
    .eq('id', input.groupId)
    .maybeSingle();

  if (existing.error) return { ok: false, message: existing.error.message };

  const churnedOn =
    status === 'churned'
      ? (existing.data?.churned_on ?? today)
      : null;

  const treatments = input.treatments
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');

  const written = await serviceClient()
    .from('client_groups')
    .update({
      name,
      status,
      onboarding_stage: input.onboardingStage.trim() || 'signed',
      retainer_cents: retainerCents,
      currency: input.currency.trim().toUpperCase() || 'USD',
      treatments,
      contact_name: input.contactName.trim() || null,
      contact_email: input.contactEmail.trim() || null,
      contact_phone: input.contactPhone.trim() || null,
      website: input.website.trim() || null,
      signed_on: signedOn,
      started_on: startedOn,
      churned_on: churnedOn,
      portal_enabled: input.portalEnabled,
    })
    .eq('id', input.groupId);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath(`/clients/${input.groupId}`);
  revalidatePath('/clients');
  revalidatePath('/dashboard');
  revalidatePath('/onboarding');
  return { ok: true, message: 'Saved.' };
}

export async function updateLocation(input: {
  locationId: string;
  groupId: string;
  name: string;
  adAccountId: string;
  timezone: string;
  schedulingType: string;
  areaCode: string;
  isActive: boolean;
}): Promise<SaveResult> {
  await requireAdmin();

  const name = input.name.trim();
  if (name === '') return { ok: false, message: 'Name cannot be empty.' };

  if (!isValidTimezone(input.timezone.trim())) {
    return {
      ok: false,
      message: `"${input.timezone}" is not a timezone. Use e.g. America/Chicago.`,
    };
  }

  // Windsor reports account ids bare; accept a pasted act_ prefix and strip it
  // so the ads sync matches either way.
  const adAccountId = input.adAccountId.trim().replace(/^act_/, '');
  if (adAccountId !== '' && !/^\d+$/.test(adAccountId)) {
    return { ok: false, message: 'Ad account id should be digits only.' };
  }

  const written = await serviceClient()
    .from('clients')
    .update({
      name,
      ad_account_id: adAccountId === '' ? null : adAccountId,
      timezone: input.timezone.trim(),
      scheduling_type: input.schedulingType.trim() || null,
      area_code: input.areaCode.trim() || null,
      is_active: input.isActive,
    })
    .eq('id', input.locationId);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath(`/clients/${input.groupId}`);
  revalidatePath('/clients');
  return { ok: true, message: 'Saved.' };
}

/**
 * Moves a sub-account to another business. This is the manual merge the CRM
 * sync refuses to guess at: it gives every new location its own business
 * record, and a human decides which ones are really one practice.
 */
export async function moveLocationToGroup(input: {
  locationId: string;
  fromGroupId: string;
  toGroupId: string;
  deleteEmptySource: boolean;
}): Promise<SaveResult> {
  await requireAdmin();

  if (input.fromGroupId === input.toGroupId) {
    return { ok: false, message: 'That is already its business.' };
  }

  const db = serviceClient();

  const target = await db
    .from('client_groups')
    .select('id, name')
    .eq('id', input.toGroupId)
    .maybeSingle();

  if (target.error) return { ok: false, message: target.error.message };
  if (!target.data) return { ok: false, message: 'Target business not found.' };

  const moved = await db
    .from('clients')
    .update({ group_id: input.toGroupId })
    .eq('id', input.locationId);

  if (moved.error) return { ok: false, message: moved.error.message };

  let note = `Moved to ${target.data.name}.`;

  if (input.deleteEmptySource) {
    const remaining = await db
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', input.fromGroupId);

    if (remaining.error) return { ok: false, message: remaining.error.message };

    // Only delete a business the move emptied, and only when asked. Deleting
    // one with locations would cascade away their appointments.
    if ((remaining.count ?? 0) === 0) {
      const removed = await db
        .from('client_groups')
        .delete()
        .eq('id', input.fromGroupId);

      if (removed.error) {
        note += ` The old business could not be removed: ${removed.error.message}`;
      } else {
        note += ' The emptied business was removed.';
      }
    } else {
      note += ` ${remaining.count} other location(s) remain, so the old business was kept.`;
    }
  }

  revalidatePath('/clients');
  revalidatePath('/dashboard');
  return { ok: true, message: note };
}
