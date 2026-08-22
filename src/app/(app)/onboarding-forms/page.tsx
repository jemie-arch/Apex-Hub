import { AlertTriangle, FileQuestion } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { formatCount, formatDateInZone, humanise } from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Onboarding Forms' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const FORM_LABELS: Record<string, string> = {
  'client-onboarding': 'Client Onboarding',
  'client-onboarding-legacy': 'Client Onboarding (legacy)',
  'new-client': 'New Client',
  'kick-off': 'Kick Off',
  availability: 'Availability',
};

/**
 * How the practice on a submission was identified, and how far to trust it.
 *
 * Only 'exact' and 'contains' link a submission to a client. The rest stay
 * unlinked on purpose: 'ambiguous' means the clinic name fitted several
 * practices equally well, which is not a match but a coin toss, and 'suggested'
 * means the closest name was close without being close enough to act on unasked.
 */
const MATCH_TONES: Record<string, Tone> = {
  exact: 'positive',
  contains: 'positive',
  suggested: 'warning',
  ambiguous: 'warning',
  none: 'negative',
  no_clinic_name: 'negative',
  test_data: 'neutral',
};

const MATCH_EXPLANATIONS: Record<string, string> = {
  exact: 'The clinic name on the form matches this practice.',
  contains:
    'The clinic name is a longer or shorter spelling of this practice.',
  suggested:
    'Close to an existing practice, but not close enough to link on its own.',
  ambiguous:
    'The clinic name fits several practices equally well, so none was chosen.',
  none: 'No practice resembles this clinic name. It may be a prospect that never signed.',
  no_clinic_name: 'This submission left the clinic name blank.',
  test_data:
    'Staff testing the form. Kept so counts reconcile with GoHighLevel, excluded from client figures.',
};

/**
 * Onboarding form submissions, made legible.
 *
 * The forms live in a GoHighLevel sub-account of their own and arrive looking
 * anonymous: answers are keyed by twenty-character custom-field ids, so a
 * submission appears to carry neither a name nor a company. It carries both. The
 * clinic name sits under "Clinic Friendly Name" or "Clinic Name"; the person's
 * name usually does not, and is recovered from the contact record instead — the
 * onboarding sub-account first, then the sales sub-account matched on email or
 * phone.
 *
 * So every row records how it was resolved. A name found by matching a phone
 * number is weaker evidence than one typed on the form, and whoever reads this
 * should be able to tell which they are looking at.
 */
export default async function OnboardingFormsPage({ searchParams }: PageProps) {
  const db = serviceClient();
  const form = single(searchParams['form']);
  const show = single(searchParams['show']) ?? 'real';

  let query = db
    .from('form_submissions')
    .select(
      'id, form_key, clinic_name, person_name, contact_email, stripe_customer_id, match_method, name_source, submitted_at, payload, client_group_id, suggested_group_id, is_test',
    )
    .order('submitted_at', { ascending: false })
    .limit(500);

  if (form) query = query.eq('form_key', form);
  if (show === 'real') query = query.eq('is_test', false);
  if (show === 'unlinked') {
    query = query.is('client_group_id', null).eq('is_test', false);
  }

  const [submissions, groups, counts] = await Promise.all([
    query,
    db.from('client_groups').select('id, name'),
    db.from('form_submissions').select('form_key, match_method, is_test, person_name'),
  ]);

  if (submissions.error) throw submissions.error;
  if (groups.error) throw groups.error;
  if (counts.error) throw counts.error;

  const groupName = new Map((groups.data ?? []).map((row) => [row.id, row.name]));
  const real = (counts.data ?? []).filter((row) => !row.is_test);

  const perForm = new Map<string, number>();
  for (const row of real) {
    perForm.set(row.form_key, (perForm.get(row.form_key) ?? 0) + 1);
  }

  const linked = real.filter(
    (row) => row.match_method === 'exact' || row.match_method === 'contains',
  ).length;
  const named = real.filter((row) => row.person_name !== null).length;

  const rows = submissions.data ?? [];

  const filters = [
    { key: 'real', label: 'All real' },
    { key: 'unlinked', label: 'Needs a decision' },
    { key: 'everything', label: 'Including tests' },
  ];

  return (
    <>
      <PageHeader
        title="Onboarding Forms"
        description="What each practice told us when they signed"
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Submissions"
          value={formatCount(real.length)}
          hint="test entries excluded"
        />
        <KPICard label="Linked to a client" value={formatCount(linked)} />
        <KPICard label="Named a person" value={formatCount(named)} />
        <KPICard
          label="Needs a decision"
          value={formatCount(real.length - linked)}
          hint="no confident practice match"
        />
      </section>

      <nav className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        {filters.map((option) => (
          <Link
            key={option.key}
            href={`/onboarding-forms?show=${option.key}${form ? `&form=${form}` : ''}`}
            className={
              show === option.key
                ? 'rounded-md bg-accent-subtle px-2.5 py-1.5 font-medium text-accent'
                : 'rounded-md border border-line px-2.5 py-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg'
            }
          >
            {option.label}
          </Link>
        ))}

        <span className="mx-1 h-4 w-px bg-line" aria-hidden />

        <Link
          href={`/onboarding-forms?show=${show}`}
          className={
            form === undefined
              ? 'rounded-md bg-accent-subtle px-2.5 py-1.5 font-medium text-accent'
              : 'rounded-md border border-line px-2.5 py-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg'
          }
        >
          Every form
        </Link>
        {[...perForm.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => (
            <Link
              key={key}
              href={`/onboarding-forms?show=${show}&form=${key}`}
              className={
                form === key
                  ? 'rounded-md bg-accent-subtle px-2.5 py-1.5 font-medium text-accent'
                  : 'rounded-md border border-line px-2.5 py-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg'
              }
            >
              {FORM_LABELS[key] ?? humanise(key)}{' '}
              <span className="text-fg-subtle">{count}</span>
            </Link>
          ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing to show"
          description="No submission matches this filter."
          icon={<FileQuestion size={22} />}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const answers = Object.entries(
              (row.payload ?? {}) as Record<string, unknown>,
            ).filter(
              ([, value]) => value !== null && String(value).trim() !== '',
            );

            const method = row.match_method ?? 'none';
            const linkedName = row.client_group_id
              ? groupName.get(row.client_group_id)
              : null;
            const suggestion = row.suggested_group_id
              ? groupName.get(row.suggested_group_id)
              : null;
            const fromSales = row.name_source === 'sales_account';

            return (
              <details
                key={row.id}
                className="overflow-hidden rounded-lg border border-line bg-surface"
              >
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-surface-hover">
                  <span className="font-medium text-fg">
                    {row.clinic_name ?? (
                      <span className="text-fg-subtle">No clinic name</span>
                    )}
                  </span>

                  {linkedName ? (
                    <Link
                      href={`/clients/${row.client_group_id}`}
                      className="text-xs text-accent hover:underline"
                    >
                      {linkedName}
                    </Link>
                  ) : null}

                  <StatusPill value={method} tone={MATCH_TONES[method] ?? 'neutral'} />

                  <span className="text-xs text-fg-subtle">
                    {FORM_LABELS[row.form_key] ?? humanise(row.form_key)}
                  </span>

                  <span className="ml-auto flex items-center gap-3 text-xs text-fg-subtle">
                    {row.person_name ? (
                      <span
                        title={
                          fromSales
                            ? 'Name from the sales sub-account, matched on email or phone'
                            : 'Name from the onboarding sub-account'
                        }
                      >
                        {row.person_name}
                        {fromSales ? ' ·' : ''}
                      </span>
                    ) : (
                      <span className="italic">no name found</span>
                    )}
                    <span>{formatDateInZone(row.submitted_at, 'UTC')}</span>
                    <span className="numeric">{answers.length} answers</span>
                  </span>
                </summary>

                <div className="border-t border-line px-4 py-3">
                  <p className="mb-3 text-xs text-fg-subtle">
                    {MATCH_EXPLANATIONS[method] ?? ''}
                    {suggestion ? ` Closest existing practice: ${suggestion}.` : ''}
                  </p>

                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 md:grid-cols-2">
                    {row.contact_email ? (
                      <div>
                        <dt className="text-xs font-medium text-fg-subtle">Email</dt>
                        <dd className="text-sm text-fg">{row.contact_email}</dd>
                      </div>
                    ) : null}
                    {row.stripe_customer_id ? (
                      <div>
                        <dt className="text-xs font-medium text-fg-subtle">
                          Stripe customer
                        </dt>
                        <dd className="numeric text-sm text-fg">
                          {row.stripe_customer_id}
                        </dd>
                      </div>
                    ) : null}
                    {answers.map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs font-medium text-fg-subtle">{label}</dt>
                        <dd className="whitespace-pre-wrap text-sm text-fg">
                          {String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </details>
            );
          })}
        </div>
      )}

      <section className="mt-6 rounded-lg border border-line bg-surface p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <AlertTriangle size={14} /> How a practice gets identified
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-fg-subtle">
          The form names the clinic, but not always the person. A name followed by
          a dot was recovered from the sales sub-account by matching the email or
          phone on the submission — weaker evidence than a name typed on the form,
          which is why the two stay distinguishable rather than being merged into
          one tidy column.
        </p>
      </section>
    </>
  );
}
