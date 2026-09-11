import { PhoneCall } from 'lucide-react';
import Link from 'next/link';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { tenant, titleCase } from '@/config/tenant.config';
import { getRepStats } from '@/lib/call-metrics';
import { cn } from '@/lib/cn';
import { formatCount, formatDuration, formatPercent } from '@/lib/format';
import { resolveRange } from '@/lib/range';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Role efficiency' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Per-agent efficiency, by role.
 *
 * This page used to carry four more panels below it, each answering a different
 * question for a different reader. They are sections in the menu now, which
 * also means this page stops running five queries to render one table.
 */
export default async function CallCenterPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const view = single(searchParams['view']) === 'csr' ? 'csr' : 'isr';

  const stats = await getRepStats(range, view);

  const isr = tenant.vocabulary.isr;
  const csr = tenant.vocabulary.csr;
  const booking = tenant.vocabulary.booking;
  const roleNoun = view === 'isr' ? isr : csr;

  // Everything except the role, so switching role keeps the chosen dates.
  const params = new URLSearchParams();
  for (const key of ['preset', 'from', 'to']) {
    const value = single(searchParams[key]);
    if (value) params.set(key, value);
  }

  return (
    <>
      <PageHeader
        eyebrow="Call centre"
        title="Role efficiency"
        description={`${roleNoun.plural} · ${range.label}`}
        actions={<DateRangePicker />}
      />

      {/* Two roles, two scorecards. Ranking an ISR against a CSR would compare
          dial volume with call quality, which are not the same job. */}
      <div className="mb-5 inline-flex rounded-md border border-line bg-surface p-0.5">
        {(
          [
            { key: 'isr', label: isr.plural },
            { key: 'csr', label: csr.plural },
          ] as const
        ).map((tab) => {
          const href = `/call-center?${new URLSearchParams({
            ...Object.fromEntries(params),
            view: tab.key,
          }).toString()}`;

          return (
            <Link
              key={tab.key}
              href={href}
              className={cn(
                'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                view === tab.key
                  ? 'bg-accent-subtle text-accent'
                  : 'text-fg-muted hover:text-fg',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {stats.length === 0 ? (
        /*
          Corrected wording. The calls sync IS built and has run — 7,139 calls.
          What is missing is the person on them: GoHighLevel stamps a user on
          171 of them, and no user_profiles row has crm_user_id set to match
          those. Saying the sync was not built sent the reader to the wrong
          problem entirely.
        */
        <EmptyState
          title={`No ${roleNoun.plural} with call activity`}
          description={
            'The calls sync has run and holds 7,139 calls, but none is ' +
            'attributed to a person: GoHighLevel names a user on 2.4% of them ' +
            'because inbound forwards off-platform, and no profile has ' +
            'crm_user_id set to match those. Bookings ARE attributed — see the ' +
            'Bookings section.'
          }
          icon={<PhoneCall size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">
                    {titleCase(roleNoun.singular)}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Dials</th>
                  <th className="px-4 py-3 text-right font-medium">Connected</th>
                  {view === 'isr' ? (
                    <>
                      <th className="px-4 py-3 text-right font-medium">
                        {titleCase(booking.plural)} set
                      </th>
                      <th className="px-4 py-3 text-right font-medium">Showed</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3 text-right font-medium">
                        Avg talk time
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Audit score
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Unscored
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {stats.map((rep) => (
                  <tr
                    key={rep.userId}
                    className="border-b border-line last:border-0 hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/call-center/${rep.userId}`}
                        className="font-medium text-fg hover:text-accent"
                      >
                        {rep.name}
                      </Link>
                      <span className="block text-xs text-fg-subtle">
                        {rep.email}
                      </span>
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg">
                      {formatCount(rep.dials)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatPercent(rep.connectRate, 0)}
                    </td>

                    {view === 'isr' ? (
                      <>
                        <td className="numeric px-4 py-3 text-right font-medium text-fg">
                          {formatCount(rep.bookingsSet)}
                        </td>
                        <td className="numeric px-4 py-3 text-right text-fg-muted">
                          {formatPercent(rep.showRate, 0)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="numeric px-4 py-3 text-right text-fg-muted">
                          {formatDuration(rep.avgTalkSeconds)}
                        </td>
                        <td className="numeric px-4 py-3 text-right font-medium text-fg">
                          {rep.avgQuality === null
                            ? '—'
                            : `${rep.avgQuality.toFixed(1)} / 10`}
                        </td>
                        <td className="numeric px-4 py-3 text-right text-fg-subtle">
                          {formatCount(rep.unscoredCalls)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'csr' ? (
        <p className="mt-4 text-xs text-fg-subtle">
          Unscored calls are shown rather than counted as zero — an unaudited
          call is not a badly handled one.
        </p>
      ) : null}
    </>
  );
}
