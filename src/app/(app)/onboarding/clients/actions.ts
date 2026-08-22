'use server';

/**
 * Everything the Client Onboarding board can change.
 *
 * Each action writes an activity row as well as the change itself. A status that
 * moved with no record of who moved it is the thing this board exists to stop.
 */
import { revalidatePath } from 'next/cache';

import { MANUAL_STATUSES, isOnboardingStatus } from '@/config/onboarding';
import { requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export interface BoardResult {
  ok: boolean;
  message: string;
}

async function actorName(userId: string): Promise<string> {
  const profile = await serviceClient()
    .from('user_profiles')
    .select('full_name, email')
    .eq('id', userId)
    .maybeSingle();

  return profile.data?.full_name ?? profile.data?.email ?? 'Someone';
}

function done(): void {
  revalidatePath('/onboarding/clients');
  revalidatePath('/onboarding');
}

/**
 * Puts a client on hold, or releases the hold.
 *
 * Only the two waiting states can be chosen. Releasing recomputes from the
 * forms and steps rather than picking a column, because the true position is
 * whatever the paperwork says.
 */
export async function setOnboardingHold(input: {
  groupId: string;
  status: string | null;
  reason?: string;
}): Promise<BoardResult> {
  const caller = await requireAdmin();
  const db = serviceClient();
  const who = await actorName(caller.id);

  if (input.status !== null) {
    if (!isOnboardingStatus(input.status) || !MANUAL_STATUSES.includes(input.status)) {
      return {
        ok: false,
        message: 'Only Waiting on team and Waiting on client can be set by hand.',
      };
    }

    const written = await db
      .from('client_groups')
      .update({
        onboarding_status: input.status,
        status_set_manually_at: new Date().toISOString(),
        status_set_by: caller.id,
      })
      .eq('id', input.groupId);

    if (written.error) return { ok: false, message: written.error.message };

    await db.from('onboarding_activity').insert({
      client_group_id: input.groupId,
      kind: 'status_changed',
      detail:
        `Held as ${input.status === 'waiting_on_team' ? 'waiting on team' : 'waiting on client'}` +
        (input.reason?.trim() ? ` — ${input.reason.trim()}` : ''),
      actor_user_id: caller.id,
      actor_name: who,
    });

    done();
    return { ok: true, message: 'Hold set.' };
  }

  // Clearing the hold: wipe the manual marker, then let the rule decide.
  const cleared = await db
    .from('client_groups')
    .update({ status_set_manually_at: null, status_set_by: null })
    .eq('id', input.groupId);

  if (cleared.error) return { ok: false, message: cleared.error.message };

  const refreshed = await db.rpc('refresh_onboarding_status', {
    p_group: input.groupId,
  });
  if (refreshed.error) return { ok: false, message: refreshed.error.message };

  await db.from('onboarding_activity').insert({
    client_group_id: input.groupId,
    kind: 'status_changed',
    detail: 'Hold released',
    actor_user_id: caller.id,
    actor_name: who,
  });

  done();
  return { ok: true, message: 'Hold released.' };
}

/** Ticks or unticks one checklist step. */
export async function setOnboardingStep(input: {
  groupId: string;
  stepKey: string;
  isDone: boolean;
  note?: string;
  assetUrl?: string;
}): Promise<BoardResult> {
  const caller = await requireAdmin();
  const db = serviceClient();

  const step = await db
    .from('onboarding_step_template')
    .select('label')
    .eq('step_key', input.stepKey)
    .maybeSingle();

  if (step.error) return { ok: false, message: step.error.message };
  if (!step.data) return { ok: false, message: 'No such step.' };

  const url = input.assetUrl?.trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return { ok: false, message: 'A link needs to start with http:// or https://' };
  }

  const written = await db.from('onboarding_step_state').upsert(
    {
      client_group_id: input.groupId,
      step_key: input.stepKey,
      done_at: input.isDone ? new Date().toISOString() : null,
      done_by: input.isDone ? caller.id : null,
      note: input.note?.trim() || null,
      asset_url: url || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_group_id,step_key' },
  );

  if (written.error) return { ok: false, message: written.error.message };

  await db.from('onboarding_activity').insert({
    client_group_id: input.groupId,
    kind: 'step',
    detail: `${input.isDone ? 'Completed' : 'Reopened'} — ${step.data.label}`,
    actor_user_id: caller.id,
    actor_name: await actorName(caller.id),
  });

  done();
  return {
    ok: true,
    message: input.isDone ? 'Step marked done.' : 'Step reopened.',
  };
}

/** Assigns the CSM who owns this onboarding. */
export async function setCsm(input: {
  groupId: string;
  userId: string | null;
}): Promise<BoardResult> {
  const caller = await requireAdmin();
  const db = serviceClient();

  const written = await db
    .from('client_groups')
    .update({ csm_user_id: input.userId })
    .eq('id', input.groupId);

  if (written.error) return { ok: false, message: written.error.message };

  const assigned = input.userId ? await actorName(input.userId) : null;

  await db.from('onboarding_activity').insert({
    client_group_id: input.groupId,
    kind: 'csm',
    detail: assigned ? `CSM set to ${assigned}` : 'CSM cleared',
    actor_user_id: caller.id,
    actor_name: await actorName(caller.id),
  });

  done();
  return { ok: true, message: assigned ? `Assigned to ${assigned}.` : 'CSM cleared.' };
}

/** Adds a note. Reuses client_notes so it shows on the client record too. */
export async function addOnboardingNote(input: {
  groupId: string;
  body: string;
}): Promise<BoardResult> {
  const caller = await requireAdmin();
  const body = input.body.trim();

  if (body === '') return { ok: false, message: 'Nothing to save.' };

  const db = serviceClient();
  const who = await actorName(caller.id);

  const written = await db.from('client_notes').insert({
    client_group_id: input.groupId,
    author_user_id: caller.id,
    author_name: who,
    body,
  });

  if (written.error) return { ok: false, message: written.error.message };

  await db.from('onboarding_activity').insert({
    client_group_id: input.groupId,
    kind: 'note',
    detail: body.length > 120 ? `${body.slice(0, 120)}…` : body,
    actor_user_id: caller.id,
    actor_name: who,
  });

  done();
  return { ok: true, message: 'Note added.' };
}
