'use server';

/**
 * Moving a business along the onboarding board.
 *
 * Admin-only, checked here rather than in the component that renders the
 * control: a server action is its own POST endpoint.
 */
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export interface MoveResult {
  ok: boolean;
  message: string;
}

export async function moveOnboardingStage(input: {
  groupId: string;
  stage: string;
}): Promise<MoveResult> {
  await requireAdmin();

  const db = serviceClient();

  // The stage list is tenant-editable config, so validate against it rather
  // than against a hardcoded set that would drift.
  const setting = await db
    .from('app_settings')
    .select('value')
    .eq('key', 'onboarding_stages')
    .maybeSingle();

  if (setting.error) return { ok: false, message: 'Could not read stages.' };

  const stages = Array.isArray(setting.data?.value)
    ? (setting.data.value as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];

  if (!stages.includes(input.stage)) {
    return { ok: false, message: `"${input.stage}" is not a known stage.` };
  }

  const written = await db
    .from('client_groups')
    .update({ onboarding_stage: input.stage })
    .eq('id', input.groupId);

  if (written.error) {
    return { ok: false, message: written.error.message };
  }

  revalidatePath('/onboarding');
  revalidatePath('/clients');
  return { ok: true, message: 'Moved.' };
}

/**
 * Marks onboarding finished: the business becomes active and starts counting
 * toward the client target. Deliberately explicit rather than inferred from
 * reaching the last column, because "live" and "counted" are business
 * decisions, not board positions.
 */
export async function markOnboardingComplete(input: {
  groupId: string;
}): Promise<MoveResult> {
  await requireAdmin();

  const db = serviceClient();
  const today = new Date().toISOString().slice(0, 10);

  const current = await db
    .from('client_groups')
    .select('started_on')
    .eq('id', input.groupId)
    .maybeSingle();

  if (current.error) return { ok: false, message: current.error.message };

  const written = await db
    .from('client_groups')
    .update({
      status: 'active',
      // Do not overwrite a start date someone already set.
      ...(current.data?.started_on ? {} : { started_on: today }),
    })
    .eq('id', input.groupId);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/onboarding');
  revalidatePath('/dashboard');
  revalidatePath('/clients');
  return { ok: true, message: 'Now active.' };
}
