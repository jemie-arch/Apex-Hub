'use server';

/**
 * Manual lead entry and classification.
 *
 * Leads arrive mostly from the agency's own ads, but a lead that came in by
 * phone or referral has to be enterable — otherwise the funnel numbers on this
 * page quietly understate the top.
 */
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';

type Classification =
  Database['public']['Enums']['lead_classification'];

const CLASSIFICATIONS: readonly Classification[] = [
  'unclassified',
  'qualified',
  'unqualified',
  'nurture',
  'duplicate',
  'spam',
];

export interface LeadResult {
  ok: boolean;
  message: string;
}

function clean(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export async function createLead(formData: FormData): Promise<LeadResult> {
  await requireAdmin();

  const name = clean(formData.get('name'));
  const email = clean(formData.get('email'));
  const phone = clean(formData.get('phone'));

  // The database enforces this too. Checking here as well turns a constraint
  // violation into a sentence somebody can act on.
  if (name === null && email === null && phone === null) {
    return {
      ok: false,
      message: 'Give at least a name, an email or a phone — otherwise the row identifies nobody.',
    };
  }

  const written = await serviceClient()
    .from('b2b_leads')
    .insert({
      name,
      email,
      phone,
      practice_name: clean(formData.get('practice_name')),
      channel: clean(formData.get('channel')) ?? 'manual',
      campaign_name: clean(formData.get('campaign_name')),
      notes: clean(formData.get('notes')),
      source: 'manual',
    });

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/leads');
  return { ok: true, message: 'Lead added.' };
}

export async function classifyLead(input: {
  id: string;
  classification: string;
}): Promise<LeadResult> {
  await requireAdmin();

  if (!(CLASSIFICATIONS as readonly string[]).includes(input.classification)) {
    return { ok: false, message: `"${input.classification}" is not a classification.` };
  }

  const written = await serviceClient()
    .from('b2b_leads')
    .update({ classification: input.classification as Classification })
    .eq('id', input.id);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/leads');
  return { ok: true, message: 'Classified.' };
}
