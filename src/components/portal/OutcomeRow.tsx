'use client';

/**
 * One appointment in the portal, with the outcome form in a centred modal.
 *
 * The practice owns these three fields; the CRM sync deliberately never
 * overwrites them once set, which is what makes this worth typing into.
 */
import { useState, useTransition } from 'react';

import {
  updateAppointmentOutcome,
  type OutcomeResult,
} from '@/app/portal/[token]/actions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  StatusPill,
  appointmentStatusTone,
  outcomeTone,
} from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import { cn } from '@/lib/cn';
import { formatDateTimeInZone, formatMoney, zoneAbbreviation } from '@/lib/format';

export interface PortalAppointment {
  id: string;
  patientName: string | null;
  scheduledAt: string;
  status: string;
  showed: boolean | null;
  outcome: string;
  valueCents: number | null;
  locationName: string;
  timezone: string;
}

const OUTCOMES = [
  { value: 'pending', label: 'Not decided yet' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'won', label: 'Started treatment' },
  { value: 'lost', label: 'Did not proceed' },
  { value: 'follow_up', label: 'Following up' },
  { value: 'unqualified', label: 'Not a fit' },
] as const;

export function OutcomeRow({
  appointment,
  token,
  currency,
  showLocation,
}: {
  appointment: PortalAppointment;
  token: string;
  currency: string;
  showLocation: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<OutcomeResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const patient = tenant.vocabulary.endUser;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      const outcome = await updateAppointmentOutcome({
        token,
        appointmentId: appointment.id,
        outcome: String(form.get('outcome') ?? 'pending'),
        showed: (String(form.get('showed') ?? 'unknown') as
          | 'yes'
          | 'no'
          | 'unknown'),
        value: String(form.get('value') ?? ''),
      });

      setResult(outcome);
      if (outcome.ok) setOpen(false);
    });
  }

  return (
    <>
      <tr
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-hover"
      >
        <td className="numeric px-4 py-3 text-fg-muted">
          {formatDateTimeInZone(appointment.scheduledAt, appointment.timezone)}
          <span className="ml-1.5 text-xs text-fg-subtle">
            {zoneAbbreviation(appointment.timezone)}
          </span>
        </td>
        {showLocation ? (
          <td className="px-4 py-3 text-fg-muted">{appointment.locationName}</td>
        ) : null}
        <td className="px-4 py-3 font-medium text-fg">
          {appointment.patientName ?? '—'}
        </td>
        <td className="px-4 py-3">
          <StatusPill
            value={appointment.status}
            tone={appointmentStatusTone(appointment.status)}
          />
        </td>
        <td className="px-4 py-3">
          <StatusPill
            value={appointment.outcome}
            tone={outcomeTone(appointment.outcome)}
          />
        </td>
        <td className="numeric px-4 py-3 text-right text-fg-muted">
          {appointment.valueCents === null
            ? '—'
            : formatMoney(appointment.valueCents, currency)}
        </td>
      </tr>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={appointment.patientName ?? titleCase(patient.singular)}
        subtitle={`${formatDateTimeInZone(appointment.scheduledAt, appointment.timezone)} ${zoneAbbreviation(appointment.timezone)}`}
        size="sm"
      >
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor={`showed-${appointment.id}`}
              className="block text-sm font-medium text-fg"
            >
              Did they attend?
            </label>
            <select
              id={`showed-${appointment.id}`}
              name="showed"
              defaultValue={
                appointment.showed === null
                  ? 'unknown'
                  : appointment.showed
                    ? 'yes'
                    : 'no'
              }
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg"
            >
              <option value="unknown">Not recorded</option>
              <option value="yes">Yes, attended</option>
              <option value="no">No, did not attend</option>
            </select>
          </div>

          <div>
            <label
              htmlFor={`outcome-${appointment.id}`}
              className="block text-sm font-medium text-fg"
            >
              Outcome
            </label>
            <select
              id={`outcome-${appointment.id}`}
              name="outcome"
              defaultValue={appointment.outcome}
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg"
            >
              {OUTCOMES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={`value-${appointment.id}`}
              className="block text-sm font-medium text-fg"
            >
              Treatment value ({currency})
            </label>
            <input
              id={`value-${appointment.id}`}
              name="value"
              type="text"
              inputMode="decimal"
              placeholder="e.g. 3779"
              defaultValue={
                appointment.valueCents === null
                  ? ''
                  : String(appointment.valueCents / 100)
              }
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg"
            />
            <p className="mt-1.5 text-xs text-fg-subtle">
              Leave blank if it is not known yet. Blank never clears a value you
              have already saved.
            </p>
          </div>

          {result && !result.ok ? (
            <p className="rounded-md bg-negative-subtle px-3 py-2 text-sm text-negative">
              {result.message}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isPending}
              className={cn(isPending && 'opacity-70')}
            >
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
