'use client';

import { CalendarPlus } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  cancelTimeOff,
  requestTimeOff,
  type TimeOffResult,
} from '@/app/(app)/account/actions';
import { Button } from '@/components/ui/Button';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { cn } from '@/lib/cn';

export interface TimeOffRow {
  id: string;
  starts_on: string;
  ends_on: string;
  kind: string;
  status: string;
  note: string | null;
  decision_note: string | null;
}

const STATUS_TONE: Record<string, Tone> = {
  pending: 'warning',
  approved: 'positive',
  declined: 'negative',
  cancelled: 'neutral',
};

/**
 * Leave types, in the order somebody is likely to want them.
 *
 * The label says what each one does to pay, because that is the only part with
 * a consequence and it is not guessable from the word. 'unpaid' is the single
 * kind that contributes no hours — the payout function draws the line there,
 * not on some separate paid flag.
 */
const KINDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'vacation', label: 'Holiday — paid' },
  { value: 'sick', label: 'Sick — paid' },
  { value: 'parental', label: 'Parental — paid' },
  { value: 'other', label: 'Other — paid' },
  { value: 'unpaid', label: 'Unpaid — adds no hours' },
];

function days(startsOn: string, endsOn: string): number {
  const start = new Date(`${startsOn}T00:00:00Z`);
  const end = new Date(`${endsOn}T00:00:00Z`);
  let count = 0;
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    // Weekends excluded, matching paid_leave_hours(). Showing seven days for a
    // week off when only five are paid would misstate it before anybody asks.
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

export function TimeOff({
  requests,
  dailyHours,
}: {
  requests: readonly TimeOffRow[];
  dailyHours: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<TimeOffResult | null>(null);
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [kind, setKind] = useState('vacation');

  const working =
    startsOn !== '' && endsOn !== '' && endsOn >= startsOn
      ? days(startsOn, endsOn)
      : null;

  return (
    <>
      <h2 className="text-sm font-semibold text-fg">Time off</h2>
      <p className="mt-1 text-xs text-fg-subtle">
        An admin approves it. Approved paid leave adds{' '}
        <b className="numeric">{dailyHours}</b> hours a working day to whichever
        payout period it falls in.
      </p>

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        action={(formData) =>
          startTransition(async () => {
            const outcome = await requestTimeOff(formData);
            setResult(outcome);
            if (outcome.ok) {
              setStartsOn('');
              setEndsOn('');
            }
          })
        }
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-fg-subtle">
            First day
          </span>
          <input
            type="date"
            name="starts_on"
            required
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className="h-10 rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-fg-subtle">
            Last day
          </span>
          <input
            type="date"
            name="ends_on"
            required
            value={endsOn}
            min={startsOn || undefined}
            onChange={(e) => setEndsOn(e.target.value)}
            className="h-10 rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-fg-subtle">
            Type
          </span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="h-10 rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-fg-subtle">
            Note (optional)
          </span>
          <input
            type="text"
            name="note"
            placeholder="Anything worth saying"
            className="h-10 rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle"
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={isPending}
          icon={<CalendarPlus size={13} />}
        >
          {isPending ? 'Sending…' : 'Request'}
        </Button>
      </form>

      {working !== null ? (
        <p className="mt-2 text-xs text-fg-subtle">
          <b className="numeric">{working}</b> working day
          {working === 1 ? '' : 's'}
          {kind === 'unpaid' ? (
            <> · unpaid, so no hours are added</>
          ) : (
            <>
              {' '}
              ·{' '}
              <b className="numeric">
                {(working * dailyHours).toFixed(working * dailyHours % 1 === 0 ? 0 : 2)}
              </b>{' '}
              hours if approved
            </>
          )}
          . Weekends are not counted.
        </p>
      ) : null}

      {result ? (
        <p
          className={cn(
            'mt-3 rounded-md px-3 py-2 text-xs',
            result.ok
              ? 'bg-positive-subtle text-positive'
              : 'bg-negative-subtle text-negative',
          )}
        >
          {result.message}
        </p>
      ) : null}

      {requests.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                <th className="py-2 pr-3 font-medium">Dates</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-3 text-fg">
                    {row.starts_on === row.ends_on
                      ? row.starts_on
                      : `${row.starts_on} → ${row.ends_on}`}
                    <span className="block text-xs text-fg-subtle">
                      {days(row.starts_on, row.ends_on)} working day
                      {days(row.starts_on, row.ends_on) === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-fg-muted">{row.kind}</td>
                  <td className="py-2.5 pr-3">
                    <StatusPill
                      value={row.status}
                      tone={STATUS_TONE[row.status] ?? 'neutral'}
                    />
                    {row.decision_note ? (
                      <span className="block text-xs text-fg-subtle">
                        {row.decision_note}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 text-right">
                    {row.status === 'pending' ? (
                      <form
                        action={(formData) =>
                          startTransition(async () => {
                            setResult(await cancelTimeOff(formData));
                          })
                        }
                      >
                        <input type="hidden" name="id" value={row.id} />
                        <Button size="sm" type="submit" disabled={isPending}>
                          Withdraw
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-5 text-xs text-fg-subtle">
          No requests yet.
        </p>
      )}
    </>
  );
}
