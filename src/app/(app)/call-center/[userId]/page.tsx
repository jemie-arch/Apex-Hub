import { notFound } from 'next/navigation';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill, appointmentStatusTone } from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import { getRepStat } from '@/lib/call-metrics';
import {
  formatCount,
  formatDateTimeInZone,
  formatDuration,
  formatPercent,
  humanise,
} from '@/lib/format';
import { bounds, resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { userId: string };
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * One person's performance page.
 *
 * Middleware decides who may open this: an admin sees anyone, an ISR or CSR
 * only their own id. Nothing here re-checks that, because route authorisation
 * belongs in one place.
 */
export default async function RepPage({ params, searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']),
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();
  const { start, end } = bounds(range.from, range.to);

  const profile = await db
    .from('user_profiles')
    .select('id, full_name, email, role')
    .eq('id', params.userId)
    .maybeSingle();

  if (profile.error) throw profile.error;
  if (!profile.data) notFound();

  // Only the two call-centre roles have a performance page.
  if (profile.data.role !== 'isr' && profile.data.role !== 'csr') notFound();

  const [stat, calls, appointments] = await Promise.all([
    getRepStat(range, params.userId),
    db
      .from('calls')
      .select('id, contact_name, direction, outcome, duration_seconds, started_at, quality_score')
      .eq('user_id', params.userId)
      .gte('started_at', start)
      .lte('started_at', end)
      .order('started_at', { ascending: false })
      .limit(100),
    db
      .from('appointments')
      .select('id, patient_name, scheduled_at, status, showed, outcome, client_id')
      .eq('booked_by_user_id', params.userId)
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at', { ascending: false })
      .limit(100),
  ]);

  if (calls.error) throw calls.error;
  if (appointments.error) throw appointments.error;

  const isCsr = profile.data.role === 'csr';
  const roleNoun = isCsr ? tenant.vocabulary.csr : tenant.vocabulary.isr;
  const booking = tenant.vocabulary.booking;
  const zone = tenant.defaultTimezone;

  return (
    <>
      <PageHeader
        title={profile.data.full_name ?? profile.data.email}
        description={`${titleCase(roleNoun.singular)} · ${range.label}`}
        actions={<DateRangePicker />}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard label="Dials" value={formatCount(stat?.dials ?? 0)} />
        <KPICard
          label="Connected"
          value={formatPercent(stat?.connectRate ?? null, 0)}
          hint={`${formatCount(stat?.connects ?? 0)} conversations`}
        />
        {isCsr ? (
          <>
            <KPICard
              label="Avg talk time"
              value={formatDuration(stat?.avgTalkSeconds ?? null)}
            />
            <KPICard
              label="Audit score"
              value={
                stat?.avgQuality === null || stat?.avgQuality === undefined
                  ? '—'
                  : `${stat.avgQuality.toFixed(1)} / 10`
              }
              hint={`${formatCount(stat?.unscoredCalls ?? 0)} not yet scored`}
            />
          </>
        ) : (
          <>
            <KPICard
              label={`${titleCase(booking.plural)} set`}
              value={formatCount(stat?.bookingsSet ?? 0)}
            />
            <KPICard
              label="Of those, showed"
              value={formatPercent(stat?.showRate ?? null, 0)}
              hint={`${formatCount(stat?.bookingsShowed ?? 0)} attended`}
            />
          </>
        )}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-lg border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-fg">
            Recent calls
          </h2>
          {(calls.data ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">
              No calls in this period. Dial logs need the calls sync, which is
              not built yet.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {(calls.data ?? []).map((call) => (
                    <tr key={call.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="block text-fg">
                          {call.contact_name ?? 'Unknown'}
                        </span>
                        <span className="numeric block text-xs text-fg-subtle">
                          {formatDateTimeInZone(call.started_at, zone, 'd MMM HH:mm')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-fg-muted">
                        {humanise(call.outcome)}
                      </td>
                      <td className="numeric px-4 py-2.5 text-right text-xs text-fg-muted">
                        {formatDuration(call.duration_seconds)}
                      </td>
                      <td className="numeric px-4 py-2.5 text-right text-xs text-fg-muted">
                        {call.quality_score === null
                          ? '—'
                          : call.quality_score.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-lg border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-fg">
            {titleCase(booking.plural)} booked
          </h2>
          {(appointments.data ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">
              None attributed in this period.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {(appointments.data ?? []).map((row) => (
                    <tr key={row.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="block text-fg">
                          {row.patient_name ?? 'Unknown'}
                        </span>
                        <span className="numeric block text-xs text-fg-subtle">
                          {formatDateTimeInZone(row.scheduled_at, zone, 'd MMM HH:mm')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill
                          value={row.status}
                          tone={appointmentStatusTone(row.status)}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-fg-muted">
                        {humanise(row.outcome)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <p className="mt-4 text-xs text-fg-subtle">
        Times shown in {zone}. Per-{tenant.vocabulary.location.singular} local
        time appears on the {tenant.vocabulary.client.singular} page.
      </p>
    </>
  );
}
