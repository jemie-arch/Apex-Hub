import { AlertTriangle, ClipboardList } from 'lucide-react';
import Link from 'next/link';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { tenant, titleCase } from '@/config/tenant.config';
import { formatCount, formatMoney, formatMoneyCompact, formatPercent } from '@/lib/format';
import { resolveRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Fulfilment' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type Status =
  | 'scheduled'
  | 'confirmed'
  | 'showed'
  | 'no_show'
  | 'cancelled'
  | 'rescheduled';

interface Row {
  clientId: string;
  name: string;
  isActive: boolean;
  booked: number;
  showed: number;
  noShow: number;
  cancelled: number;
  upcoming: number;
  caseValueCents: number;
  withOutcome: number;
  collectedCents: number;
  uncollectedCents: number;
}

/** Booked means an appointment happened as an event, not that it went ahead. */
function isBooked(status: Status): boolean {
  return status !== 'rescheduled';
}

/**
 * The fulfilment tracker, per client.
 *
 * The Google Sheet's Stats Dashboard rebuilt on the database, and it still shows
 * less than the sheet's column headings promise — see the panel at the foot,
 * which names each remaining gap and its cause rather than rendering a zero that
 * reads as a fact. A blank column invites someone to conclude the number is
 * nought; a stated gap invites them to go and fix it.
 *
 * This page counts EVERY appointment GoHighLevel holds, which is why its
 * bookings exceed the dashboard's. The dashboard counts the ad-sourced
 * consultations from the tracker, because only those have outcomes; this page
 * needs the synced table instead, because cancelled and upcoming are statuses
 * the spreadsheet does not record at all. Two questions, two sources, and the
 * difference is stated on the page rather than left for someone to trip over.
 */
export default async function FulfilmentPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']) ?? 'last_30',
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const db = serviceClient();
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [appointments, clientRows, charges, coverage] = await Promise.all([
    db
      .from('appointments')
      .select('client_id, status, showed, outcome, value_cents, scheduled_at')
      .gte('booked_at', fromIso)
      .lte('booked_at', toIso)
      .limit(5000),
    db.from('clients').select('id, name, is_active').order('name'),
    db
      .from('billing_charges')
      .select('client_id, amount_cents, outcome')
      .gte('occurred_at', fromIso)
      .lte('occurred_at', toIso)
      .limit(2000),
    // Whole-table counts, not range-limited: these answer "is this pipeline
    // connected at all", which a date filter would obscure.
    Promise.all([
      db.from('ad_snapshots').select('id', { count: 'exact', head: true }),
      db.from('calls').select('id', { count: 'exact', head: true }),
      db
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .not('campaign_external_id', 'is', null),
      db.from('appointments').select('id', { count: 'exact', head: true }),
      // The spreadsheet's own history, which does carry campaign ids.
      db
        .from('tracker_appointments')
        .select('id', { count: 'exact', head: true })
        .not('campaign_external_id', 'is', null),
      db
        .from('tracker_leads')
        .select('id', { count: 'exact', head: true })
        .not('campaign_external_id', 'is', null),
    ]),
  ]);

  if (appointments.error) throw appointments.error;
  if (clientRows.error) throw clientRows.error;
  if (charges.error) throw charges.error;

  const [adRows, callRows, attributed, allAppointments, trackerAttributed, trackerLeads] =
    coverage;

  const rows = new Map<string, Row>();
  for (const client of clientRows.data ?? []) {
    rows.set(client.id, {
      clientId: client.id,
      name: client.name,
      isActive: client.is_active,
      booked: 0,
      showed: 0,
      noShow: 0,
      cancelled: 0,
      upcoming: 0,
      caseValueCents: 0,
      withOutcome: 0,
      collectedCents: 0,
      uncollectedCents: 0,
    });
  }

  let booked = 0;
  let showed = 0;

  for (const appointment of appointments.data ?? []) {
    if (!appointment.client_id) continue;
    const row = rows.get(appointment.client_id);
    if (!row) continue;

    const status = appointment.status as Status;
    if (isBooked(status)) {
      row.booked += 1;
      booked += 1;
    }

    if (status === 'showed') {
      row.showed += 1;
      showed += 1;
    } else if (status === 'no_show') {
      row.noShow += 1;
    } else if (status === 'cancelled') {
      row.cancelled += 1;
    } else if (status === 'scheduled' || status === 'confirmed') {
      row.upcoming += 1;
    }

    if (appointment.value_cents) row.caseValueCents += appointment.value_cents;
    // 'pending' is the default the row was created with, so it is the absence of
    // an answer rather than an answer.
    if (appointment.outcome && appointment.outcome !== 'pending') {
      row.withOutcome += 1;
    }
  }

  let collectedCents = 0;
  for (const charge of charges.data ?? []) {
    const row = charge.client_id ? rows.get(charge.client_id) : undefined;
    if (charge.outcome === 'succeeded') collectedCents += charge.amount_cents;
    if (!row) continue;

    if (charge.outcome === 'succeeded') row.collectedCents += charge.amount_cents;
    else if (charge.outcome === 'failed') row.uncollectedCents += charge.amount_cents;
  }

  const decided = showed + [...rows.values()].reduce((sum, r) => sum + r.noShow, 0);
  const showRate = decided > 0 ? showed / decided : null;

  const table = [...rows.values()]
    .filter((row) => row.booked > 0 || row.isActive)
    .sort((a, b) => b.booked - a.booked || a.name.localeCompare(b.name));

  const client = tenant.vocabulary.client;

  const gaps = [
    {
      metric: 'Attribution on bookings taken from today onward',
      cause: `The tracker carries a campaign id on ${formatCount(trackerAttributed.count ?? 0)} bookings and ${formatCount(trackerLeads.count ?? 0)} leads, so spend can be joined to a booking for the imported period. The live GoHighLevel sync carries one on ${formatCount(attributed.count ?? 0)} of ${formatCount(allAppointments.count ?? 0)}, because the UTM template from the SOP is not reaching its attribution. So the spreadsheet answers this and the CRM does not, which means the answer stops the day someone stops maintaining the sheet.`,
    },
    {
      metric: 'Impressions · clicks · reach',
      cause:
        'The tracker records spend and leads per ad per day but not impressions, clicks or reach, so click-through and cost per click cannot be worked out from it. Those need the ad platforms themselves, through Windsor.',
    },
    {
      metric: 'Case value · revenue · return on ad spend',
      cause:
        'The tracker records that a consultation closed but never what it was worth, and the synced appointments carry a case value on none of their rows. So close rate is now answerable and revenue is not — the missing figure is money, and no amount of joining fixes a number nobody wrote down.',
    },
  ];

  return (
    <>
      <PageHeader
        title="Fulfilment"
        description={`What each ${client.singular} got · ${range.label}`}
        actions={<DateRangePicker />}
      />

      <p className="mb-4 max-w-3xl text-xs text-fg-subtle">
        Every appointment in GoHighLevel, of every kind — hygiene and recalls
        included. The dashboard counts only the ad-sourced consultations, so its
        bookings figure is smaller than this one on purpose.
      </p>

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard label="Booked" value={formatCount(booked)} />
        <KPICard label="Showed" value={formatCount(showed)} />
        <KPICard
          label="Show rate"
          value={showRate === null ? '—' : formatPercent(showRate)}
          hint="of consultations with a recorded outcome"
        />
        <KPICard label="Collected" value={formatMoneyCompact(collectedCents)} />
      </section>

      {table.length === 0 ? (
        <EmptyState
          title="Nothing booked in this period"
          description="Widen the date range, or check that the appointments sync has run."
          icon={<ClipboardList size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">
                    {titleCase(client.singular)}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Booked</th>
                  <th className="px-4 py-3 text-right font-medium">Showed</th>
                  <th className="px-4 py-3 text-right font-medium">No show</th>
                  <th className="px-4 py-3 text-right font-medium">Cancelled</th>
                  <th className="px-4 py-3 text-right font-medium">Upcoming</th>
                  <th className="px-4 py-3 text-right font-medium">Show rate</th>
                  <th className="px-4 py-3 text-right font-medium">Collected</th>
                  <th className="px-4 py-3 text-right font-medium">Uncollected</th>
                </tr>
              </thead>
              <tbody>
                {table.map((row) => {
                  const settled = row.showed + row.noShow;
                  const rate = settled > 0 ? row.showed / settled : null;

                  return (
                    <tr
                      key={row.clientId}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/clients/${row.clientId}`}
                          className="text-fg hover:text-accent"
                        >
                          {row.name}
                        </Link>
                        {!row.isActive ? (
                          <span className="ml-2 text-xs text-fg-subtle">paused</span>
                        ) : null}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg">
                        {row.booked || '—'}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-positive">
                        {row.showed || '—'}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {row.noShow || '—'}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {row.cancelled || '—'}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {row.upcoming || '—'}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {rate === null ? '—' : formatPercent(rate)}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-positive">
                        {row.collectedCents > 0
                          ? formatMoney(row.collectedCents)
                          : '—'}
                      </td>
                      <td className="numeric px-4 py-3 text-right">
                        {row.uncollectedCents > 0 ? (
                          <span className="text-negative">
                            {formatMoney(row.uncollectedCents)}
                          </span>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <section className="mt-6 rounded-lg border border-high bg-surface p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <AlertTriangle size={14} /> Not shown, and why
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-fg-subtle">
          Absent rather than zero — a blank column invites the conclusion that
          the number is nought, which would be worse than saying nothing. The
          list is shorter than it was: {formatCount(adRows.count ?? 0)} ad-days
          of spend and {formatCount(callRows.count ?? 0)} calls have since been
          imported from tabs of the same spreadsheet, which is where they had
          been all along.
        </p>
        <dl className="mt-4 space-y-3">
          {gaps.map((gap) => (
            <div key={gap.metric}>
              <dt className="text-sm font-medium text-fg">{gap.metric}</dt>
              <dd className="mt-0.5 max-w-3xl text-xs text-fg-muted">
                {gap.cause}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
