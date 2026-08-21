import { Check } from 'lucide-react';
import { notFound } from 'next/navigation';

import { OnboardingForm } from '@/components/portal/OnboardingForm';
import { tenant } from '@/config/tenant.config';
import { formatDateInZone, humanise } from '@/lib/format';
import { resolvePortal } from '@/lib/portal';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Launch progress',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
}

/**
 * Where the practice is in the launch sequence, and the form that starts it.
 *
 * The step list comes from app_settings rather than a constant here, so it
 * stays the same list the internal board uses — two copies would drift and the
 * practice would be shown a sequence nobody is working to.
 */
export default async function PortalOnboardingPage({ params }: PageProps) {
  const portal = await resolvePortal(params.token);
  if (!portal) notFound();

  const db = serviceClient();

  const [setting, submissions] = await Promise.all([
    db
      .from('app_settings')
      .select('value')
      .eq('key', 'onboarding_stages')
      .maybeSingle(),
    db
      .from('form_submissions')
      .select('id, submitted_at')
      .eq('client_group_id', portal.group.id)
      .eq('form_key', 'onboarding')
      .order('submitted_at', { ascending: false })
      .limit(5),
  ]);

  if (setting.error) throw setting.error;
  if (submissions.error) throw submissions.error;

  const stages = Array.isArray(setting.data?.value)
    ? (setting.data.value as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];

  const currentIndex = stages.indexOf(portal.group.onboardingStage);
  const sent = submissions.data ?? [];
  const zone = tenant.defaultTimezone;

  return (
    <>
      <h2 className="text-lg font-semibold text-fg">Launch progress</h2>
      <p className="mt-0.5 text-sm text-fg-muted">
        {currentIndex >= 0
          ? `Step ${currentIndex + 1} of ${stages.length} — ${humanise(
              portal.group.onboardingStage,
            )}`
          : `Current stage: ${humanise(portal.group.onboardingStage)}`}
      </p>

      <ol className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {stages.map((stage, index) => {
          const done = currentIndex >= 0 && index < currentIndex;
          const active = index === currentIndex;

          return (
            <li
              key={stage}
              className={
                active
                  ? 'flex items-center gap-3 rounded-lg border border-accent bg-accent-subtle px-4 py-3'
                  : 'flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3'
              }
            >
              <span
                className={
                  done
                    ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-positive-subtle text-positive'
                    : active
                      ? 'numeric flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-contrast'
                      : 'numeric flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs text-fg-subtle'
                }
                aria-hidden
              >
                {done ? <Check size={13} /> : index + 1}
              </span>
              <span
                className={
                  active
                    ? 'text-sm font-medium text-accent'
                    : done
                      ? 'text-sm text-fg-muted'
                      : 'text-sm text-fg-subtle'
                }
              >
                {humanise(stage)}
              </span>
            </li>
          );
        })}
      </ol>

      <hr className="my-8 border-line" />

      <h2 className="text-lg font-semibold text-fg">Onboarding form</h2>
      <p className="mt-0.5 mb-5 text-sm text-fg-muted">
        The answers here decide what we advertise and how we book patients in.
        {sent.length > 0
          ? ` Last sent ${formatDateInZone(sent[0]?.submitted_at ?? '', zone)}.`
          : ''}
      </p>

      <OnboardingForm token={params.token} />
    </>
  );
}
