/**
 * When an onboarding submission is allowed to build a sub-account on its own.
 *
 * Shared rather than duplicated, because two things now provision without a
 * human: the nightly backlog pass and the webhook that receives GoHighLevel
 * form submissions. Two copies of a rule that decides whether to create a live
 * GoHighLevel account is two chances to widen one and forget the other.
 */
import type { serviceClient } from '@/lib/supabase/service';

/**
 * Only auto-provision submissions from here onwards.
 *
 * form_submissions was imported once, on 22 August 2026, and holds 143 rows
 * going back to October 2025. None of them has ever been provisioned, so any
 * rule that says "provision what has not been provisioned" would queue a
 * sub-account for every one — most for practices that have been live for
 * months. Creating a second account for a running practice is expensive to undo
 * and confusing to everyone who touches it afterwards.
 *
 * So automation applies forward. Everything older stays provisionable by hand
 * from the Onboarding page, where somebody can see which practice it is before
 * pressing the button.
 */
export const AUTO_PROVISION_FROM = new Date(Date.UTC(2026, 8, 1)).toISOString();

/**
 * Does this group already have a GoHighLevel account under any of its locations?
 *
 * The second rail. An existing client filling the onboarding form again is a
 * normal thing for a practice to do — they lose the link, or a new office
 * manager starts and works through the welcome email — and it must never
 * produce a duplicate sub-account.
 */
export async function groupAlreadyLive(
  db: ReturnType<typeof serviceClient>,
  groupId: string | null,
): Promise<boolean> {
  if (!groupId) return false;

  const existing = await db
    .from('clients')
    .select('id')
    .eq('group_id', groupId)
    .not('crm_location_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;
  return existing.data !== null;
}

/** Is this submission recent enough to provision without being asked? */
export function withinAutoProvisionWindow(submittedAt: string | null): boolean {
  if (!submittedAt) return false;
  return submittedAt >= AUTO_PROVISION_FROM;
}
