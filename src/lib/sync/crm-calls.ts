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
  const eligible = (clientRows.data ?? []).filter(
    (row) => !churned.has(row.group_id),
  );

  /*
   * Stalest first, and this is a data-loss fix rather than a tidy-up.
   *
   * The budget allows 400 conversations at 40 per sub-account, so exactly ten
   * get read per run. With no ordering, Postgres returned the same ten every
   * night — meaning 63 of 73 practices' calls were NEVER read, and the run
   * reported "budget exhausted, later locations were not read" as though that
   * were a capacity note rather than 86% of the fleet going unsampled
   * indefinitely.
   *
   * Ordering by when each sub-account's calls were last written fixes it
   * without new state: a location nobody has ever read sorts first, then the
   * one read longest ago. Coverage rotates on its own and stays fair, and the
   * queue self-corrects if the budget or the client count changes.
   *
   * Raising the budget instead would not work: 73 x 40 is nearly 3,000 requests
   * against a sync that has to finish inside the cycle's time slice.
   */
  const lastSeen = await db
    .from('calls')
    .select('client_id, synced_at')
    .not('client_id', 'is', null)
    .order('synced_at', { ascending: false });
  if (lastSeen.error) throw lastSeen.error;

  const freshestByClient = new Map<string, string>();
  for (const row of lastSeen.data ?? []) {
    // Descending, so the first sighting of a client is its most recent call.
    if (row.client_id && !freshestByClient.has(row.client_id)) {
      freshestByClient.set(row.client_id, row.synced_at ?? '');
    }
  }

  const locations = [...eligible].sort((a, b) => {
    const left = freshestByClient.get(a.id);
    const right = freshestByClient.get(b.id);
    if (left === undefined && right === undefined) {
      return a.name.localeCompare(b.name);
    }
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    return left.localeCompare(right);
  });

  ctx.note('locations_eligible', locations.length);
  ctx.note('locations_never_read', locations.filter((l) => !freshestByClient.has(l.id)).length);

  const userIdByCrm = new Map(
    (profiles.data ?? []).flatMap((row) =>
      row.crm_user_id ? [[row.crm_user_id, row.id] as const] : [],
    ),
  );

  if (userIdByCrm.size === 0) {
    /*
     * Without this link the leaderboard stays empty, which looks like a broken
     * sync rather than missing setup.
     *
     * Deliberately does not promise that setting it fixes attribution. Only the
     * calls GoHighLevel stamped a user on can ever be attributed by mapping,
     * and that has been a small fraction of them — see the ownerless count
     * below for the rest. Claiming otherwise sends somebody off to map users
     * expecting thousands of calls to resolve.
     */
    ctx.recordError(
      'no user_profiles row has crm_user_id set, so no call can be attributed ' +
        'to a person. Set it for each ISR and CSR — though that only reaches ' +
        'the calls GoHighLevel recorded a user against.',
    );
  }

  let budget = CONVERSATION_BUDGET;
  /*
   * Two different failures, counted apart on purpose.
   *
   * 'unlinked' is ours to fix: GoHighLevel told us who made the call and no
   * user_profiles row claims that id. 'ownerless' is not: the call record
   * arrived with no user on it at all, which is what an inbound call to a
   * shared number looks like, and no amount of mapping will attribute it.
   *
   * Reporting them as one number named the wrong cause for almost all of them.
   * 4,734 of 4,753 calls carry no GoHighLevel user, so "link the ISRs" read as
   * a fix for the whole backlog when its ceiling was 19 calls.
   */
  let unlinked = 0;
  let ownerless = 0;

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
      if (!userId) {
        if (call.userId) unlinked += 1;
        else ownerless += 1;
      }

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

  if (unlinked > 0) {
    ctx.recordError(
      `${unlinked} call(s) name a GoHighLevel user that no user_profiles row ` +
        'claims. Set crm_user_id on the matching profile and these attribute ' +
        'on the next run.',
      { unlinked },
    );
  }

  /*
   * Logged, not recorded as an error. Nobody here can act on it: the call
   * arrived from GoHighLevel with no user on it, so there is nothing to map.
   * Firing an alert every night for something with no available fix is how an
   * alert stops being read.
   */
  if (ownerless > 0) {
    ctx.log(
      `${ownerless} call(s) arrived with no GoHighLevel user on them, so no ` +
        'mapping can attribute them. Attributing these needs a change in how ' +
        'GoHighLevel assigns calls, not a change here.',
    );
  }

  /*
   * Logged, not an error, now that coverage rotates.
   *
   * Exhausting the budget is the expected steady state: 73 sub-accounts cannot
   * fit in 400 conversations, and they are not meant to. What made it worth an
   * alert before was that the same ten were read every night while the rest
   * were never touched — and that is fixed by the ordering above, not by a
   * bigger number. Reported with the coverage figure so the rotation can be
   * seen working rather than assumed.
   */
  if (budget <= 0) {
    const covered = locations.filter((l) => freshestByClient.has(l.id)).length;
    ctx.log(
      `budget of ${CONVERSATION_BUDGET} conversations spent across ` +
        `${Math.ceil(CONVERSATION_BUDGET / CONVERSATIONS_PER_LOCATION)} of ` +
        `${locations.length} sub-accounts, stalest first. ` +
        `${locations.length - covered} have never been read; they sort to the ` +
        'front of the next run.',
    );
  }
}
