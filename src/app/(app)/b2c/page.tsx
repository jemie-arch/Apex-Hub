import {
  ConsultationsTable,
  type ConsultationRow,
} from '@/components/b2c/ConsultationsTable';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { tenant, titleCase } from '@/config/tenant.config';
import { formatCount, formatMoneyCompact, formatPercent } from '@/lib/format';
import { bounds, resolveRange } from '@/lib/range';
import { OutcomeRow, type QueueAppointment } from '@/components/b2c/OutcomeRow';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Consultations' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Every patient consultation across every client, in one list.
 *
 * The per-client view answers "how is this practice doing"; this one answers
 * "what happened today", which is a different question and needs its own page.
 */
export default async function ConsultationsPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']) ?? 'last_30',
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();
  const { start, end } = bounds(range.from, range.to);

  const [appointments, locations, groups, queue] = await Promise.all([
    db
      .from('appointments')
      .select(
        'id, client_id, patient_name, scheduled_at, status, showed, outcome, value_cents, booked_by_name, attribution_source',
      )
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .order('scheduled_at', { ascending: false })
      .limit(400),
    db.from('clients').select('id, name, group_id, timezone'),
    db.from('client_groups').select('id, name, currency'),
    /*
     * The call centre's work queue, and deliberately NOT bounded by the date
     * range above.
     *
     * The range exists so the numbers describe a period. A queue does the
     * opposite job: an appointment that happened three months ago and still has
     * no outcome is the one most worth chasing, and a date filter is exactly
     * what would hide it. Bounded instead by "already happened" and "nobody has
     * said what happened yet".
     */
    db
      .from('appointments')
      .select(
        'id, client_id, patient_name, scheduled_at, showed, showed_source, second_consult_showed, cc_on_file, financing_approved, outcome, value_cents',
      )
      .lte('scheduled_at', new Date().toISOString())
      .eq('outcome', 'pending')
      .order('scheduled_at', { ascending: false })
      .limit(100),
  ]);

  if (appointments.error) throw appointments.error;
  if (locations.error) throw locations.error;
  if (groups.error) throw groups.error;

  const locationById = new Map(
    (locations.data ?? []).map((row) => [row.id, row]),
  );
  const groupById = new Map((groups.data ?? []).map((row) => [row.id, row]));

  const rows = appointments.data ?? [];
  let showed = 0;
  let won = 0;
  let revenueCents = 0;
  let awaiting = 0;

  for (const row of rows) {
    if (row.showed === true) showed += 1;
    if (row.outcome === 'pending') awaiting += 1;
    if (row.outcome === 'won') {
      won += 1;
      revenueCents += row.value_cents ?? 0;
    }
  }

  const booking = tenant.vocabulary.booking;
  const patient = tenant.vocabulary.endUser;

  /*
   * Daily shape for the two sparklines, from the rows already loaded.
   *
   * Note this list is capped at 400 rows, so the series describes what is on the
   * page rather than the whole period. That is the right thing for a shape sitting
   * beside a figure computed from the same 400.
   */
  const dayAt = new Map<string, number>();
  const dayOrder: string[] = [];
  for (const row of rows) {
    const day = row.scheduled_at.slice(0, 10);
    if (!dayAt.has(day)) {
      dayAt.set(day, dayOrder.length);
      dayOrder.push(day);
    }
  }
  // The query sorts newest first; a chart reads left to right in time.
  dayOrder.reverse();
  dayOrder.forEach((day, index) => dayAt.set(day, index));

  const bookedByDay = new Array<number>(dayOrder.length).fill(0);
  const showedByDay = new Array<number>(dayOrder.length).fill(0);
  for (const row of rows) {
    const index = dayAt.get(row.scheduled_at.slice(0, 10));
    if (index === undefined) continue;
    bookedByDay[index] = (bookedByDay[index] ?? 0) + 1;
    if (row.showed === true) showedByDay[index] = (showedByDay[index] ?? 0) + 1;
  }

  /*
   * Flattened for the client component: the practice and its timezone resolved
   * here rather than passing three lookup maps across the boundary, which would
   * serialise every location and group to the browser to read a handful.
   */
  const tableRows: ConsultationRow[] = rows.map((row) => {
    const location = locationById.get(row.client_id);
    const group = location ? groupById.get(location.group_id) : null;

    return {
      id: row.id,
      clientId: row.client_id,
      patientName: row.patient_name,
      scheduledAt: row.scheduled_at,
      status: row.status,
      showed: row.showed,
      outcome: row.outcome,
      valueCents: row.value_cents,
      bookedByName: row.booked_by_name,
      attributionSource: row.attribution_source,
      clientName: location?.name ?? 'Unknown location',
      groupId: group?.id ?? null,
      groupName: group?.name ?? location?.name ?? 'Unknown',
      timezone: location?.timezone ?? tenant.defaultTimezone,
    };
  });

  /*
   * Practice name comes from the same map the table uses, so a clinic renamed
   * in GoHighLevel reads the same in both places.
   */
  const queueRows: QueueAppointment[] = (queue.error ? [] : (queue.data ?? [])).map(
    (row) => ({
      id: row.id,
      patientName: row.patient_name,
      practice: row.client_id
        ? (locationById.get(row.client_id)?.name ?? null)
        : null,
      scheduledAt: row.scheduled_at,
      showed: row.showed,
      showedSource: row.showed_source,
      secondConsultShowed: row.second_consult_showed,
      ccOnFile: row.cc_on_file,
      financingApproved: row.financing_approved,
      outcome: row.outcome ?? 'pending',
      valueCents: row.value_cents,
    }),
  );

  return (
    <>
      <PageHeader
        eyebrow="Consultations"
        pill={{
          label: `${formatCount(rows.length)} in period`,
          tone: 'accent',
        }}
        title="Who came in, and what happened"
        description={
          <>
            {range.label} · <span className="text-accent">{formatCount(showed)}</span>{' '}
            of {formatCount(rows.length)} attended. Every {patient.singular}{' '}
            {booking.singular} across all {tenant.vocabulary.client.plural}, one per
            row — Fulfilment groups the same {booking.plural} by practice.
          </>
        }
        actions={<DateRangePicker />}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Booked"
          value={formatCount(rows.length)}
          hint={`${formatCount(awaiting)} awaiting an outcome`}
          series={bookedByDay}
        />
        <KPICard
          label="Attended"
          value={formatPercent(rows.length === 0 ? null : showed / rows.length, 0)}
          hint={`${formatCount(showed)} of ${formatCount(rows.length)}`}
          series={showedByDay}
          seriesTone="positive"
        />
        <KPICard
          label="Started treatment"
          value={formatCount(won)}
          hint={
            won === 0 && rows.length > 0
              ? 'no outcome recorded on any row'
              : `of ${formatCount(showed)} who attended`
          }
        />
        <KPICard
          label="Treatment value"
          value={revenueCents === 0 ? '—' : formatMoneyCompact(revenueCents)}
          hint={revenueCents === 0 ? 'no case value recorded' : 'on started treatments'}
        />
      </section>

      {queueRows.length > 0 && (
        <section className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-fg">
              Waiting on an outcome
            </h2>
            <p className="mt-1 max-w-3xl text-xs text-fg-subtle">
              {formatCount(queueRows.length)} appointment
              {queueRows.length === 1 ? ' has' : 's have'} happened with nobody
              saying what came of {queueRows.length === 1 ? 'it' : 'them'}.
              Recording it here writes straight to the Hub — no form, no
              spreadsheet in between.
            </p>
            <p className="mt-1 max-w-3xl text-xs text-fg-subtle">
              Not filtered by the date range above, on purpose: an appointment
              from three months ago with no outcome is the one most worth
              chasing, and a date filter is what would hide it.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">
                    {titleCase(patient.singular)}
                  </th>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Attended?</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                  <th className="px-4 py-3 font-medium">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {queueRows.map((row) => (
                  <OutcomeRow key={row.id} appointment={row} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ConsultationsTable
        rows={tableRows}
        patientNoun={titleCase(patient.singular)}
        clientNoun={titleCase(tenant.vocabulary.client.singular)}
        bookingPlural={booking.plural}
      />

      <p className="mt-4 text-xs text-fg-subtle">
        Newest 400 in the range. Outcomes and treatment values are entered by
        the practice in its portal — the agency can see that someone booked and
        whether they turned up, but only the clinic knows what they went ahead
        with.
      </p>
    </>
  );
}
