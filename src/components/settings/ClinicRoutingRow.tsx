'use client';

/**
 * One clinic's routing, editable in place.
 *
 * A client component only because it needs a pending state and a message. The
 * three server actions are imported directly rather than passed in as props —
 * passing a function across the server/client boundary typechecks, builds, and
 * then fails at render, which has already broken this app once.
 */
import { Check, Loader2, X } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  setRoutingSheet,
  unverifyRouting,
  verifyRouting,
} from '@/app/(app)/settings/clinic-routing/actions';
import { cn } from '@/lib/cn';

export interface ClinicRoutingRowProps {
  clientId: string;
  practice: string;
  locationId: string;
  sheetId: string | null;
  verified: boolean;
  source: string;
  /** Sheet the audited scenario writes to, when there is one to compare against. */
  scenarioSheetId: string | null;
  scenarioPractice: string | null;
}

export function ClinicRoutingRow({
  clientId,
  practice,
  locationId,
  sheetId,
  verified,
  source,
  scenarioSheetId,
  scenarioPractice,
}: ClinicRoutingRowProps) {
  const [draft, setDraft] = useState(sheetId ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      const result = await action();
      setMessage(result.message);
      setFailed(!result.ok);
    });
  }

  const dirty = draft.trim() !== (sheetId ?? '');
  /*
   * Worth showing loudly. If the Hub routes a clinic somewhere other than where
   * its own scenario writes today, switching to the consolidated scenario moves
   * that practice's bookings to a different file — which may be the intended
   * fix, or may be this row being wrong.
   */
  const disagrees =
    scenarioSheetId !== null && sheetId !== null && scenarioSheetId !== sheetId;

  return (
    <tr className="border-b border-line last:border-0 align-top">
      <td className="px-4 py-3">
        <div className="text-fg">{practice}</div>
        <div className="font-mono text-xs text-fg-subtle">{locationId}</div>
      </td>

      <td className="px-4 py-3">
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setMessage(null);
          }}
          placeholder="paste the sheet URL or id"
          spellCheck={false}
          className="w-full min-w-[14rem] rounded border border-line bg-surface-sunken px-2 py-1 font-mono text-xs text-fg"
        />
        {disagrees && (
          <p className="mt-1 text-xs text-warning">
            Differs from what {scenarioPractice ?? 'its scenario'} writes to
            today.
          </p>
        )}
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
      </td>

      <td className="px-4 py-3">
        <span
          className={cn(
            'inline-block rounded px-2 py-0.5 text-xs font-medium',
            verified
              ? 'bg-positive-subtle text-positive'
              : 'bg-surface-sunken text-fg-muted',
          )}
        >
          {verified ? 'in use' : 'not in use'}
        </span>
        <div className="mt-1 text-xs text-fg-subtle">{source}</div>
      </td>

      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setRoutingSheet({ clientId, sheetId: draft }))}
              className="rounded border border-line px-2 py-1 text-xs text-fg hover:bg-surface-sunken disabled:opacity-50"
            >
              Save
            </button>
          )}
          {!verified ? (
            <button
              type="button"
              disabled={pending || dirty || draft.trim() === ''}
              onClick={() => run(() => verifyRouting({ clientId }))}
              title={
                dirty
                  ? 'Save the sheet first'
                  : draft.trim() === ''
                    ? 'There is no sheet to verify'
                    : 'Confirm this sheet belongs to this practice'
              }
              className="inline-flex items-center gap-1 rounded border border-positive px-2 py-1 text-xs text-positive hover:bg-positive-subtle disabled:opacity-40"
            >
              <Check size={12} /> Verify
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => unverifyRouting({ clientId }))}
              className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-fg-muted hover:bg-surface-sunken disabled:opacity-50"
            >
              <X size={12} /> Withdraw
            </button>
          )}
          {pending && <Loader2 size={12} className="animate-spin text-fg-subtle" />}
        </div>
      </td>
    </tr>
  );
}
