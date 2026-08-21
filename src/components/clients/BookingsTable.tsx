'use client';

/**
 * Appointment list with a centred modal for the detail view.
 *
 * Each row carries its own location and timezone rather than the table taking
 * one: a practice can run sub-accounts in different states, and rendering a
 * Texas appointment in California time would be quietly wrong.
 */
import { useState } from 'react';

import { Modal } from '@/components/ui/Modal';
import {
  StatusPill,
  appointmentStatusTone,
  outcomeTone,
} from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import {
  formatDateTimeInZone,
  formatMoney,
  humanise,
  zoneAbbreviation,
} from '@/lib/format';
import type { AppointmentRow } from '@/types/database';

export type BookingRow = Pick<
  AppointmentRow,
  | 'id'
  | 'client_id'
  | 'patient_name'
  | 'patient_phone'
  | 'address'
  | 'scheduled_at'
  | 'status'
  | 'showed'
  | 'outcome'
  | 'value_cents'
  | 'booked_by_name'
  | 'attribution_source'
  | 'utm_campaign'
  | 'notes'
  | 'reschedule_count'
> & {
  locationName: string;
  timezone: string;
};

export function BookingsTable({
  rows,
  currency,
  showLocation = false,
}: {
  rows: BookingRow[];
  currency: string;
  /** Only worth a column when the business runs more than one sub-account. */
  showLocation?: boolean;
}) {
  const [selected, setSelected] = useState<BookingRow | null>(null);
  const booking = tenant.vocabulary.booking;
  const patient = tenant.vocabulary.endUser;

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-fg-muted">
        No {booking.plural} in this period.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
              <th className="px-4 py-3 font-medium">When</th>
              {showLocation ? (
                <th className="px-4 py-3 font-medium">
                  {titleCase(tenant.vocabulary.location.singular)}
                </th>
              ) : null}
              <th className="px-4 py-3 font-medium">
                {titleCase(patient.singular)}
              </th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Outcome</th>
              <th className="px-4 py-3 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => setSelected(row)}
                className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-hover"
              >
                <td className="numeric px-4 py-3 text-fg-muted">
                  {formatDateTimeInZone(row.scheduled_at, row.timezone)}
                  <span className="ml-1.5 text-xs text-fg-subtle">
                    {zoneAbbreviation(row.timezone)}
                  </span>
                </td>
                {showLocation ? (
                  <td className="px-4 py-3 text-fg-muted">{row.locationName}</td>
                ) : null}
                <td className="px-4 py-3 font-medium text-fg">
                  {row.patient_name ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <StatusPill
                    value={row.status}
                    tone={appointmentStatusTone(row.status)}
                  />
                </td>
                <td className="px-4 py-3">
                  <StatusPill value={row.outcome} tone={outcomeTone(row.outcome)} />
                </td>
                <td className="numeric px-4 py-3 text-right text-fg-muted">
                  {row.value_cents === null
                    ? '—'
                    : formatMoney(row.value_cents, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.patient_name ?? titleCase(booking.singular)}
        subtitle={
          selected
            ? `${selected.locationName} · ` +
              `${formatDateTimeInZone(selected.scheduled_at, selected.timezone)} ` +
              zoneAbbreviation(selected.timezone)
            : undefined
        }
      >
        {selected ? (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label="Status" value={humanise(selected.status)} />
            <Field
              label="Showed"
              value={
                selected.showed === null
                  ? 'Not recorded'
                  : selected.showed
                    ? 'Yes'
                    : 'No'
              }
            />
            <Field label="Outcome" value={humanise(selected.outcome)} />
            <Field
              label="Treatment value"
              value={
                selected.value_cents === null
                  ? '—'
                  : formatMoney(selected.value_cents, currency)
              }
            />
            <Field label="Phone" value={selected.patient_phone ?? '—'} />
            <Field label="Booked by" value={selected.booked_by_name ?? '—'} />
            <Field label="Source" value={selected.attribution_source ?? '—'} />
            <Field label="Campaign" value={selected.utm_campaign ?? '—'} />
            {selected.reschedule_count > 0 ? (
              <Field
                label="Rescheduled"
                value={`${selected.reschedule_count} time(s)`}
              />
            ) : null}
            <div className="sm:col-span-2">
              <Field label="Address" value={selected.address ?? '—'} />
            </div>
            {selected.notes ? (
              <div className="sm:col-span-2">
                <Field label="Notes" value={selected.notes} />
              </div>
            ) : null}
          </dl>
        ) : null}
      </Modal>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-fg">{value}</dd>
    </div>
  );
}
