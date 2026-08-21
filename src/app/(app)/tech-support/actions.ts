'use server';

/**
 * Tech-call bookings.
 *
 * A request arrives with a preferred time at best; confirming it is what turns
 * it into an appointment, and confirming is deliberately an explicit act rather
 * than something that happens by a row appearing.
 */
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';

type TechCallStatus = Database['public']['Enums']['tech_call_status'];

const STATUSES: readonly TechCallStatus[] = [
  'requested',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
];

export interface TechCallResult {
  ok: boolean;
  message: string;
}

function clean(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export async function createTechCall(
  formData: FormData,
): Promise<TechCallResult> {
  await requireAdmin();

  const topic = clean(formData.get('topic'));
  if (topic === null) return { ok: false, message: 'Say what the call is about.' };

  const scheduled = clean(formData.get('scheduled_at'));

  const written = await serviceClient()
    .from('tech_calls')
    .insert({
      client_group_id: clean(formData.get('client_group_id')),
      requested_by: clean(formData.get('requested_by')),
      contact_email: clean(formData.get('contact_email')),
      contact_phone: clean(formData.get('contact_phone')),
      topic,
      detail: clean(formData.get('detail')),
      // A datetime-local value carries no zone. It is interpreted as the
      // viewer's, which is what somebody typing a time into this form means.
      scheduled_at: scheduled === null ? null : new Date(scheduled).toISOString(),
    });

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/tech-support');
  return { ok: true, message: 'Booking added.' };
}

export async function setTechCallStatus(input: {
  id: string;
  status: string;
  scheduledAt?: string | null;
  resolution?: string | null;
}): Promise<TechCallResult> {
  const caller = await requireAdmin();

  if (!(STATUSES as readonly string[]).includes(input.status)) {
    return { ok: false, message: `"${input.status}" is not a status.` };
  }

  const status = input.status as TechCallStatus;

  // Confirming without a time would leave a "confirmed" call nobody can attend.
  if (status === 'confirmed' && !input.scheduledAt) {
    return { ok: false, message: 'Set the time you are confirming it for.' };
  }

  const patch: Database['public']['Tables']['tech_calls']['Update'] = { status };

  if (input.scheduledAt) {
    patch.scheduled_at = new Date(input.scheduledAt).toISOString();
  }
  if (input.resolution !== undefined) {
    patch.resolution =
      input.resolution === null || input.resolution.trim() === ''
        ? null
        : input.resolution.trim();
  }
  if (status === 'confirmed') {
    patch.confirmed_by = caller.id;
    patch.confirmed_at = new Date().toISOString();
  }

  const written = await serviceClient()
    .from('tech_calls')
    .update(patch)
    .eq('id', input.id);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/tech-support');
  return { ok: true, message: 'Updated.' };
}
