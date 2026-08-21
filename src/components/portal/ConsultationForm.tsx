'use client';

/**
 * The consultation outcome form — the point of the portal.
 *
 * Every question defaults to "not asked yet" rather than to a value, and an
 * unanswered question is left alone on save. A form that defaulted to "did not
 * attend" would quietly turn silence into data.
 */
import { useState, useTransition } from 'react';

import {
  saveConsultationOutcome,
  type PortalResult,
} from '@/app/portal/[token]/portal-actions';
import { Button } from '@/components/ui/Button';
import { tenant, titleCase } from '@/config/tenant.config';
import { cn } from '@/lib/cn';

export interface ConsultationDetail {
  id: string;
  patientName: string | null;
  scheduledAt: string;
  status: string;
  showed: boolean | null;
  outcome: string;
  valueCents: number | null;
  financingApproved: boolean | null;
  leadQuality: string | null;
  notes: string | null;
}

const OUTCOMES = [
  { value: 'pending', label: 'Not decided yet' },
  { value: 'quoted', label: 'Quoted, deciding' },
  { value: 'won', label: 'Started treatment' },
  { value: 'lost', label: 'Did not proceed' },
  { value: 'follow_up', label: 'Following up' },
  { value: 'unqualified', label: 'Not a fit' },
] as const;

const QUALITIES = [
  { value: '', label: 'Not saying' },
  { value: 'high', label: 'Good fit' },
  { value: 'medium', label: 'Worth having' },
  { value: 'low', label: 'Poor fit' },
  { value: 'unusable', label: 'Should not have reached us' },
] as const;

const TRI = [
  { value: 'unknown', label: 'Not asked yet' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

const FIELD =
  'h-10 w-full rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle';

function triFrom(value: boolean | null): 'yes' | 'no' | 'unknown' {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

export function ConsultationForm({
  token,
  appointment,
  currency,
}: {
  token: string;
  appointment: ConsultationDetail;
  currency: string;
}) {
  const [outcome, setOutcome] = useState(appointment.outcome);
  const [showed, setShowed] = useState(triFrom(appointment.showed));
  const [financing, setFinancing] = useState(
    triFrom(appointment.financingApproved),
  );
  const [quality, setQuality] = useState(appointment.leadQuality ?? '');
  const [value, setValue] = useState(
    appointment.valueCents === null
      ? ''
      : (appointment.valueCents / 100).toFixed(0),
  );
  const [notes, setNotes] = useState(appointment.notes ?? '');
  const [result, setResult] = useState<PortalResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const patient = tenant.vocabulary.endUser;

  return (
    <div className="rounded-lg border border-line bg-surface p-6">
      {result ? (
        <p
          className={cn(
            'mb-5 rounded-md px-3 py-2 text-sm',
            result.ok
              ? 'bg-positive-subtle text-positive'
              : 'bg-negative-subtle text-negative',
          )}
        >
          {result.message}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            Did they attend?
          </span>
          <select
            value={showed}
            onChange={(event) =>
              setShowed(event.target.value as 'yes' | 'no' | 'unknown')
            }
            className={FIELD}
          >
            {TRI.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            What happened?
          </span>
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            className={FIELD}
          >
            {OUTCOMES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            Treatment value ({currency})
          </span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
            placeholder="e.g. 4800"
            className={FIELD}
          />
          <span className="text-[11px] text-fg-subtle">
            The full treatment plan, not the deposit.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            Financing approved?
          </span>
          <select
            value={financing}
            onChange={(event) =>
              setFinancing(event.target.value as 'yes' | 'no' | 'unknown')
            }
            className={FIELD}
          >
            {TRI.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">
            How good a {patient.singular} were they?
          </span>
          <select
            value={quality}
            onChange={(event) => setQuality(event.target.value)}
            className={FIELD}
          >
            {QUALITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-fg-subtle">
            This is what we use to aim the advertising.
          </span>
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-fg-muted">
            Anything else
          </span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg"
            placeholder="Treatment discussed, why they hesitated, when to follow up."
          />
        </label>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-xs text-fg-subtle">
          {titleCase(patient.singular)}:{' '}
          {appointment.patientName ?? 'not given'}
        </p>
        <Button
          variant="primary"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setResult(
                await saveConsultationOutcome({
                  token,
                  appointmentId: appointment.id,
                  outcome,
                  showed,
                  value,
                  financing,
                  leadQuality: quality,
                  notes,
                }),
              );
            })
          }
        >
          {isPending ? 'Saving…' : 'Save outcome'}
        </Button>
      </div>
    </div>
  );
}
