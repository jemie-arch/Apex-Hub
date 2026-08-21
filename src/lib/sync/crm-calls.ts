/**
 * GoHighLevel conversation calls -> calls (the call-centre leaderboard).
 *
 * Heavily bounded on purpose. GoHighLevel has no bulk call-log endpoint, so
 * this walks conversations and keeps the call-type messages — two requests per
 * conversation. Left unbounded across 45 sub-accounts it would exhaust the
 * function timeout long before it finished, so both the per-location and the
 * whole-run budgets are capped and any shortfall is reported rather than
 * looking like a quiet week on the phones.
 *
 * NOTE: this is the least verified mapping in the codebase. If the ISRs
 * actually dial through Hot Prospector rather than GoHighLevel, their real
 * volume lives there and this sync will under-report. Check one location's
 * numbers against the dialler before trusting the leaderboard.
 */
import type { CallOutcome } from '@/types/database';

import { chunk, ID_LOOKUP_BATCH } from '@/lib/chunk';
import { listConversationCalls } from '@/lib/integrations/ghl';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/** Conversations inspected per sub-account. */
const CONVERSATIONS_PER_LOCATION = 40;

/** Whole-run ceiling on conversations, across every sub-account. */
const CONVERSATION_BUDGET = 400;

export function mapOutcome(status: string | null): CallOutcome | null {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
    case 'answered':
      return 'connected';
    case 'no-answer':
    case 'no_answer':
    case 'noanswer':
      return 'no_answer';
    case 'busy':
      return 'busy';
    case 'voicemail':
      return 'voicemail';
    // 'failed', 'canceled' and anything unrecognised stay null: an unknown
    // outcome is not the same as a bad one, and the leaderboard treats null as
    // "not counted" rather than "not connected".
    default:
      return null;
  }
}

export async function syncCrmCalls(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  const [clientRows, churnedGroups, profiles] = await Promise.all([
    db
      .from('clients')
      .select('id, name, group_id, crm_location_id')
      .not('crm_location_id', 'is', null)
      .eq('is_active', true),
    db.from('client_groups').select('id').eq('status', 'churned'),
    db
      .from('user_profiles')
      .select('id, crm_user_id')
      .not('crm_user_id', 'is', null),
  ]);

  if (clientRows.error) throw clientRows.error;
  if (churnedGroups.error) throw churnedGroups.error;
  if (profiles.error) throw profiles.error;

  const churned = new Set((churnedGroups.data ?? []).map((row) => row.id));
  const locations = (clientRows.data ?? []).filter(
    (row) => !churned.has(row.group_id),
  );

  const userIdByCrm = new Map(
    (profiles.data ?? []).flatMap((row) =>
      row.crm_user_id ? [[row.crm_user_id, row.id] as const] : [],
    ),
  );

  if (userIdByCrm.size === 0) {
    // Without this link every call lands unattributed and the leaderboard
    // stays empty, which looks like a broken sync rather than missing setup.
    ctx.recordError(
      'no user_profiles row has crm_user_id set, so calls cannot be ' +
        'attributed to anyone. Set it for each ISR and CSR.',
    );
  }

  let budget = CONVERSATION_BUDGET;
  let unattributed = 0;

  for (const location of locations) {
    if (!location.crm_location_id) continue;
    if (budget <= 0) break;

    const take = Math.min(CONVERSATIONS_PER_LOCATION, budget);
    budget -= take;

    let calls;
    try {
      calls = await listConversationCalls(
        location.id,
        location.crm_location_id,
        take,
      );
    } catch (error) {
      // One location's dead token must not stop the rest.
      ctx.recordError(`could not read calls for ${location.name}`, {
        clientId: location.id,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    ctx.counts.read += calls.length;
    if (calls.length === 0) continue;

    const ids = calls.map((call) => call.id);
    const seen = new Set<string>();

    // Batched for the same reason as the appointments lookup: the id list
    // travels in the query string.
    for (const batch of chunk(ids, ID_LOOKUP_BATCH)) {
      const existing = await db
        .from('calls')
        .select('id, crm_call_id')
        .in('crm_call_id', batch);
      if (existing.error) throw existing.error;

      for (const row of existing.data ?? []) {
        if (row.crm_call_id) seen.add(row.crm_call_id);
      }
    }

    const fresh = calls.filter((call) => !seen.has(call.id));
    ctx.counts.skipped += calls.length - fresh.length;

    if (fresh.length === 0) continue;

    const rows = fresh.map((call) => {
      const userId = call.userId ? (userIdByCrm.get(call.userId) ?? null) : null;
      if (!userId) unattributed += 1;

      return {
        user_id: userId,
        client_id: location.id,
        crm_call_id: call.id,
        crm_user_id: call.userId,
        contact_name: call.contactName,
        contact_phone: call.contactPhone,
        direction:
          (call.direction ?? '').toLowerCase() === 'inbound'
            ? ('inbound' as const)
            : ('outbound' as const),
        outcome: mapOutcome(call.status),
        duration_seconds: call.durationSeconds,
        started_at: call.startedAt,
        recording_url: call.recordingUrl,
        synced_at: new Date().toISOString(),
      };
    });

    // crm_call_id is unique, so this is a genuine upsert and re-running is safe.
    const written = await db
      .from('calls')
      .upsert(rows, { onConflict: 'crm_call_id' });

    if (written.error) {
      ctx.recordError(`could not write calls for ${location.name}`, {
        clientId: location.id,
        detail: written.error.message,
      });
      continue;
    }

    ctx.counts.created += rows.length;
  }

  if (unattributed > 0) {
    ctx.recordError(
      `${unattributed} call(s) could not be attributed to a person — the ` +
        'GoHighLevel user is not linked to any user_profiles.crm_user_id.',
    );
  }

  if (budget <= 0) {
    ctx.recordError(
      `conversation budget of ${CONVERSATION_BUDGET} was exhausted, so later ` +
        'locations were not read at all. Raise the cap or run this more often.',
    );
  }
}
