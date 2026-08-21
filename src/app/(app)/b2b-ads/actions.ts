'use server';

/**
 * Recording a day of the agency's own ad performance.
 *
 * Upserts on the natural key (day, platform, campaign, ad) so entering the
 * same day twice corrects it rather than double-counting it — the same rule
 * the automatic imports follow.
 */
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export interface AdDayResult {
  ok: boolean;
  message: string;
}

/** Money arrives as dollars from a human and is stored as cents. */
function cents(value: FormDataEntryValue | null): number {
  if (typeof value !== 'string' || value.trim() === '') return 0;
  const amount = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function count(value: FormDataEntryValue | null): number {
  if (typeof value !== 'string' || value.trim() === '') return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function text(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export async function recordAdDay(formData: FormData): Promise<AdDayResult> {
  await requireAdmin();

  const day = text(formData.get('day'));
  const campaign = text(formData.get('campaign_name'));

  if (day === null) return { ok: false, message: 'Pick a date.' };
  if (campaign === null) return { ok: false, message: 'Name the campaign.' };

  const written = await serviceClient()
    .from('b2b_ad_days')
    .upsert(
      {
        day,
        platform: text(formData.get('platform')) ?? 'meta',
        campaign_name: campaign,
        ad_name: text(formData.get('ad_name')) ?? '(all ads)',
        spend_cents: cents(formData.get('spend')),
        impressions: count(formData.get('impressions')),
        clicks: count(formData.get('clicks')),
        leads: count(formData.get('leads')),
        bookings: count(formData.get('bookings')),
        showed: count(formData.get('showed')),
        qualified_calls: count(formData.get('qualified_calls')),
        closed: count(formData.get('closed')),
        cash_collected_cents: cents(formData.get('cash_collected')),
        source: 'manual',
      },
      { onConflict: 'day,platform,campaign_name,ad_name' },
    );

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/b2b-ads');
  return { ok: true, message: `Recorded ${campaign} for ${day}.` };
}
