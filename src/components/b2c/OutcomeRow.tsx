'use client';

/**
 * One appointment in the call centre's queue, recorded in place.
 *
 * Deliberately not the portal's ConsultationForm. That is a full-page form for
 * a practice looking at one appointment; this is a queue somebody works down
 * after a shift, so attendance — the thing they are actually recording — is the
 * first control and the only one they have to touch. Everything else stays out
 * of the way until it is relevant.
 *
 * Every select defaults to "not asked yet" rather than to a value, and the
 * action leaves unanswered questions alone. A row that defaulted to "did not
 * attend" would turn an unworked queue into a pile of no-shows, and a no-show
 * is exactly what a practice does not get billed for.
 */
import { Check, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { recordConsultation } from '@/app/(app)/b2c/actions';
import { cn } from '@/lib/cn';

export interface QueueAppointment {
  id: string;
  patientName: string | null;
  practice: string | null;
  scheduledAt: string;
  showed: boolean | null;
  showedSource: string | null;
  secondConsultShowed: boolean | null;
  ccOnFile: boolean | null;
  financingApproved: boolean | null;
  outcome: string;
  valueCents: number | null;
}

const OUTCOMES = [
  { value: 'pending', label: 'Not decided yet' },
  { value: 'quoted', label: 'Quoted, deciding' },
  { value: 'won', label: 'Started treatment' },
  { value: 'lost', label: 'Did not proceed' },
  { value: 'follow_up', label: 'Following up' },
  { value: 'unqualified', label: 'Not a fit' },
] as const;

const TRI = [
  { value: 'unknown', label: 'Not asked' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

const SELECT =
  'h-8 rounded border border-line bg-surface-sunken px-2 text-xs text-fg';

function triFrom(value: boolean | null): 'yes' | 'no' | 'unknown' {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

/** Who last answered the attendance question, in words rather than a code. */
function sourceLabel(source: string | null): string | null {
  if (source === 'crm') return 'from the calendar';
  if (source === 'client') return 'the practice said';
  if (source === 'call_centre') return 'recorded here';
  return null;
}

export function OutcomeRow({ appointment }: { appointment: QueueAppointment }) {
  const [showed, setShowed] = useState(triFrom(appointment.showed));
  const [outcome, setOutcome] = useState(appointment.outcome);
  const [secondShowed, setSecondShowed] = useState(
    triFrom(appointment.secondConsultShowed),
  );
  const [ccOnFile, setCcOnFile] = useState(triFrom(appointment.ccOnFile));
  const [financing, setFinancing] = useState(
    triFrom(appointment.financingApproved),
  );
  const [value, setValue] = useState(
    appointment.valueCents === null
      ? ''
      : (appointment.valueCents / 100).toFixed(0),
  );
  const [notes, setNotes] = useState('');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const result = await recordConsultation({
        appointmentId: appointment.id,
        outcome,
        showed,
        secondShowed,
        ccOnFile,
        financing,
        value,
        notes,
      });
      setMessage(result.message);
      setFailed(!result.ok);
      if (result.ok) setNotes('');
    });
  }

  const source = sourceLabel(appointment.showedSource);

  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-4 py-3">
        <div className="text-fg">{appointment.patientName ?? 'no name'}</div>
        <div className="text-xs text-fg-subtle">
          {appointment.practice ?? 'unknown practice'}
        </div>
      </td>

      <td className="px-4 py-3 text-xs text-fg-muted">
        {new Date(appointment.scheduledAt).toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC',
        })}
      </td>

      <td className="px-4 py-3">
        <select
          value={showed}
          onChange={(event) => {
            setShowed(event.target.value as 'yes' | 'no' | 'unknown');
            setMessage(null);
          }}
          className={SELECT}
          aria-label="Did they attend"
        >
          {TRI.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {source && (
          <div className="mt-1 text-xs text-fg-subtle">{source}</div>
        )}
      </td>

      <td className="px-4 py-3">
        <select
          value={outcome}
          onChange={(event) => {
            setOutcome(event.target.value);
            setMessage(null);
          }}
          className={SELECT}
          aria-label="Outcome"
        >
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </td>

      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded border border-positive px-2 py-1 text-xs text-positive hover:bg-positive-subtle disabled:opacity-40"
          >
            {pending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save
          </button>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="rounded border border-line px-2 py-1 text-xs text-fg-muted hover:bg-surface-sunken"
          >
            {open ? 'Less' : 'More'}
          </button>
        </div>

        {message && (
          <p
            className={cn(
              'mt-1 text-xs',
              failed ? 'text-negative' : 'text-positive',
            )}
          >
            {message}
          </p>
        )}

        {open && (
          <div className="mt-2 grid grid-cols-1 gap-2">
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              Second consult
              <select
                value={secondShowed}
                onChange={(e) =>
                  setSecondShowed(e.target.value as 'yes' | 'no' | 'unknown')
                }
                className={SELECT}
              >
                {TRI.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              Card on file
              <select
                value={ccOnFile}
                onChange={(e) =>
                  setCcOnFile(e.target.value as 'yes' | 'no' | 'unknown')
                }
                className={SELECT}
              >
                {TRI.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              Financing
              <select
                value={financing}
                onChange={(e) =>
                  setFinancing(e.target.value as 'yes' | 'no' | 'unknown')
                }
                className={SELECT}
              >
                {TRI.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              Treatment value
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="leave empty if unknown"
                inputMode="decimal"
                className={cn(SELECT, 'w-40')}
              />
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth recording"
              rows={2}
              className="rounded border border-line bg-surface-sunken px-2 py-1 text-xs text-fg"
            />
          </div>
        )}
      </td>
    </tr>
  );
}
