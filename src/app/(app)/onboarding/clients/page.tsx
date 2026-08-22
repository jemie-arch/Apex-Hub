import { ExternalLink } from 'lucide-react';

import { ClientOnboardingBoard } from '@/components/onboarding/ClientOnboardingBoard';
import { PageHeader } from '@/components/ui/PageHeader';
import { KICKOFF_FORM_URL } from '@/config/onboarding';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Client Onboarding' };

/**
 * The Client Onboarding board.
 *
 * Everything a card shows is loaded here; everything behind the card is loaded
 * here too, because the whole board is well under a thousand rows and one query
 * per client on click would be an N+1 that only shows up once the agency grows.
 */
export default async function ClientOnboardingPage() {
  const db = serviceClient();

  const [groups, staff, steps, stepState, forms, notes, activity] =
    await Promise.all([
      db
        .from('client_groups')
        .select(
          'id, name, status, onboarding_status, onboarding_added_at, csm_user_id, onboarding_call_at, launch_call_at, contact_name, contact_email, contact_phone, website, retainer_cents, treatments, signed_on, started_on, portal_token, portal_enabled, status_set_manually_at',
        )
        .order('onboarding_added_at', { ascending: false }),
      db
        .from('user_profiles')
        .select('id, full_name, email, role')
        .neq('role', 'client')
        .eq('is_active', true)
        .order('full_name'),
      db
        .from('onboarding_step_template')
        .select('step_key, group_key, group_label, label, automated, sort_order')
        .eq('is_active', true)
        .order('sort_order'),
      db
        .from('onboarding_step_state')
        .select('client_group_id, step_key, done_at, done_by, note, asset_url'),
      db
        .from('form_submissions')
        .select(
          'id, client_group_id, form_key, clinic_name, person_name, contact_email, contact_phone, stripe_customer_id, submitted_at, payload, match_method',
        )
        .eq('is_test', false)
        .order('submitted_at', { ascending: false }),
      db
        .from('client_notes')
        .select('id, client_group_id, author_name, body, created_at')
        .order('created_at', { ascending: false })
        .limit(600),
      db
        .from('onboarding_activity')
        .select('id, client_group_id, kind, detail, actor_name, created_at')
        .order('created_at', { ascending: false })
        .limit(1000),
    ]);

  for (const result of [groups, staff, steps, stepState, forms, notes, activity]) {
    if (result.error) throw result.error;
  }

  return (
    <>
      <PageHeader
        title="Client Onboarding"
        description="Where every signed practice is, and what is left to do"
        actions={
          <a
            href={KICKOFF_FORM_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <ExternalLink size={14} /> Kick off form
          </a>
        }
      />

      <ClientOnboardingBoard
        groups={groups.data ?? []}
        staff={staff.data ?? []}
        steps={steps.data ?? []}
        stepState={stepState.data ?? []}
        forms={forms.data ?? []}
        notes={notes.data ?? []}
        activity={activity.data ?? []}
      />
    </>
  );
}
