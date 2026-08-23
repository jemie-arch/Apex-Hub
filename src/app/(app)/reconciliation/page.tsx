/**
 * Delivered against invoiced, and everything standing between the two.
 *
 * Reads the appointment ledger, which is the only place one row equals one
 * appointment. Every other tracker in the stack stores daily counts, which is
 * why an appointment could go missing and nobody could say which one.
 *
 * Two things this page will not do.
 *
 * It does not collapse reschedule chains silently. A patient who no-showed and
 * came back a week later produced two ledger rows and both are true; consultation
 * counts here follow the final attempt in each chain, and the row count is shown
 * beside it so the difference is visible rather than smoothed away.
 *
 * It does not present the unbilled figure as a single number. Some of it is at
 * practices with no charge at all, which cannot be a matching artefact, and some
 * is at practices whose charges carry no consultation names, where nothing can
 * be attributed either way. Those are a floor and a ceiling, and reporting the
 * midpoint as fact would be the same class of mistake this page exists to catch.
 */
import { AlertTriangle } from 'lucide-react';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/cn';
import { formatCount, formatMoneyCompact, formatPercent } from '@/lib/format';
import { resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Reconciliation' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Highest severity first, matching the view's own ordering. */
const SEVERITY_TONE: Record<number, string> = {
  1: 'bg-negative-subtle text-negative',
  2: 'bg-negative-subtle text-negative',
  3: 'bg-warning-subtle text-warning',
  4: 'bg-warning-subtle text-warning',
  5: 'bg-surface-sunken text-fg-muted',
};

export default async function ReconciliationPage({ searchParams }: PageProps) {
  const db = serviceClient();
  // Same default as Fulfilment, so the two pages answer about the same period
  // unless somebody deliberately changes it.
  const range = resolveRange({
    preset: single(searchParams['preset']) ?? 'last_30',
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const [ledger, exceptions, charges] = await Promise.all([
    db
      .from('appointment_ledger')
      .select(
        'id, client_id, appointment_at, outcome, outcome_source, billing_state, amount_cents, reschedule_of, attempt_number, seen_in',
      )
      .gte('appointment_at', range.from.toISOString())
      .lte('appointment_at', range.to.toISOString()),
    db
      .from('appointment_exceptions')
      .select('id, practice, patient_name, appointment_at, outcome, billing_state, exception, severity')
      .order('severity')
      .limit(400),
    db
      .from('billing_charges')
      .select('client_id, consult_names')
      .eq('outcome', 'succeeded'),
  ]);

  if (ledger.error) throw ledger.error;
  if (exceptions.error) throw exceptions.error;
  if (charges.error) throw charges.error;

  const rows = ledger.data ?? [];

  /*
   * One consultation per reschedule chain: the row nothing else supersedes.
   * A chain of three attempts is one consultation that took three goes, not
   * three consultations.
   */
  const superseded = new Set(
    rows.flatMap((row) => (row.reschedule_of ? [row.reschedule_of] : [])),
  );
  const consultations = rows.filter((row) => !superseded.has(row.id));

  const delivered = consultations.filter((row) => row.outcome === 'showed');
  const noShowed = consultations.filter((row) => row.outcome === 'no_show');
  const unresolved = consultations.filter((row) => row.outcome === 'pending');

  const billed = delivered.filter((row) => row.billing_state === 'billed');
  const unbilled = delivered.filter((row) => row.billing_state === 'billable');

  const billedCents = billed.reduce((sum, row) => sum + (row.amount_cents ?? 0), 0);

  /*
   * The floor and the ceiling on unbilled work.
   *
   * A practice with no successful charge at all cannot have had its
   * consultations matched away by a naming problem, so those are certain. A
   * practice whose charges carry no consultation names cannot be reconciled in
   * either direction, so those are unknown rather than unbilled.
   */
  const clientsWithACharge = new Set(
    (charges.data ?? []).flatMap((row) => (row.client_id ? [row.client_id] : [])),
  );
  const clientsWithNamelessCharges = new Set(
    (charges.data ?? [])
      .filter((row) => (row.consult_names ?? []).length === 0)
      .flatMap((row) => (row.client_id ? [row.client_id] : [])),
  );

  const certainlyUnbilled = unbilled.filter(
    (row) => row.client_id !== null && !clientsWithACharge.has(row.client_id),
  ).length;
  const unknowable = unbilled.filter(
    (row) => row.client_id !== null && clientsWithNamelessCharges.has(row.client_id),
  ).length;

  const showRate =
    delivered.length + noShowed.length === 0
      ? null
      : delivered.length / (delivered.length + noShowed.length);

  const exceptionRows = exceptions.data ?? [];
  const urgent = exceptionRows.filter((row) => (row.severity ?? 9) <= 2);

  /** Grouped for the summary strip; the table below stays row-level. */
  const byException = new Map<string, number>();
  for (const row of exceptionRows) {
    const label = row.exception ?? 'unlabelled';
    byException.set(label, (byException.get(label) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        eyebrow="Delivered against invoiced"
        title="Reconciliation"
        pill={
          unbilled.length > 0
            ? {
                label: `${formatCount(unbilled.length)} delivered, not billed`,
                tone: 'warning',
              }
            : { label: 'Everything delivered is billed', tone: 'positive' }
        }
        description={
          <>
            {formatCount(consultations.length)} consultation
            {consultations.length === 1 ? '' : 's'} from{' '}
            {formatCount(rows.length)} ledger row
            {rows.length === 1 ? '' : 's'} · {range.label}
          </>
        }
        actions={<DateRangePicker />}
      />

      {rows.length === 0 ? (
        <section className="panel rounded-lg border border-line bg-surface p-10 text-center">
          <p className="text-sm text-fg-muted">
            No appointments in this range. The ledger fills from the calendar and
            the fulfilment tracker on the daily cycle.
          </p>
        </section>
      ) : (
        <>
          <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KPICard label="Delivered" value={formatCount(delivered.length)} />
            <KPICard
              label="Billed"
              value={formatCount(billed.length)}
              hint={
                delivered.length > 0
                  ? `${formatPercent(billed.length / delivered.length)} of delivered · ${formatMoneyCompact(billedCents)}`
                  : undefined
              }
            />
            <KPICard
              label="Delivered, not billed"
              value={formatCount(unbilled.length)}
              higherIsBetter={false}
              hint={
                unbilled.length > 0
                  ? `${formatCount(certainlyUnbilled)} certain · ${formatCount(unknowable)} unknowable`
                  : undefined
              }
            />
            <KPICard
              label="No outcome"
              value={formatCount(unresolved.length)}
              higherIsBetter={false}
              hint="nobody said what happened"
            />
            <KPICard
              label="Show rate"
              value={showRate === null ? '—' : formatPercent(showRate)}
              hint={`${formatCount(delivered.length)} of ${formatCount(delivered.length + noShowed.length)} resolved`}
            />
          </section>

          {unbilled.length > 0 && (
            <section className="mb-6 rounded-lg border border-accent-subtle bg-surface p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                <AlertTriangle size={14} /> Why the unbilled figure is a range
              </h2>
              <p className="mt-1 max-w-3xl text-xs text-fg-subtle">
                <b>{formatCount(certainlyUnbilled)}</b> of these are at practices
                with no successful charge at all in this period, so a naming
                mismatch cannot explain them.{' '}
                <b>{formatCount(unknowable)}</b> are at practices whose charges
                carry no consultation names, which means nothing can attribute
                them in either direction — they are unknown rather than unbilled.
                Treat the first number as the floor and {formatCount(unbilled.length)}{' '}
                as the ceiling.
              </p>
            </section>
          )}
        </>
      )}

      <section className="panel overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">
            Needs somebody to act
          </h2>
          <span className="text-xs text-fg-subtle">
            {formatCount(exceptionRows.length)} open ·{' '}
            {urgent.length > 0 ? (
              <span className="text-negative">
                {formatCount(urgent.length)} where money and evidence disagree
              </span>
            ) : (
              'none urgent'
            )}
          </span>
        </div>

        {exceptionRows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-fg-muted">
            Nothing outstanding. Every appointment has an outcome and every
            delivered one has a charge behind it.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">What is wrong</th>
                  <th className="px-4 py-3 font-medium">Practice</th>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Appointment</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                  <th className="px-4 py-3 font-medium">Billing</th>
                </tr>
              </thead>
              <tbody>
                {exceptionRows.map((row) => (
                  <tr
                    key={row.id}
                    className="row-interactive border-b border-line last:border-0 hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-block rounded px-2 py-0.5 text-xs',
                          SEVERITY_TONE[row.severity ?? 5] ??
                            'bg-surface-sunken text-fg-muted',
                        )}
                      >
                        {row.exception}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-fg">{row.practice}</td>
                    <td className="px-4 py-3 text-fg-muted">
                      {row.patient_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {row.appointment_at
                        ? new Date(row.appointment_at).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            timeZone: 'UTC',
                          })
                        : 'no date'}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">{row.outcome}</td>
                    <td className="px-4 py-3 text-fg-muted">
                      {row.billing_state}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
