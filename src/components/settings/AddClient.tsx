'use client';

/**
 * Adds a client login: a practice signing in to see its own portal.
 *
 * A separate form from Add teammate rather than one more role button on it.
 * The two answer different questions — a teammate needs pages, a client needs a
 * practice — and merging them meant the practice was never asked for. A client
 * login without one authenticates fine and then lands on nothing, which is a
 * far more confusing failure than an empty sidebar.
 *
 * So the practice is the first field, not the last, and the button stays
 * disabled until one is chosen.
 */
import { Building2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { addClientLogin, type AccessResult } from '@/app/(app)/settings/access/actions';
import { SetPasswordLink } from '@/components/settings/SetPasswordLink';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export interface PracticeOption {
  id: string;
  name: string;
  portalEnabled: boolean;
}

const inputClass =
  'w-full rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 text-sm text-fg';

export function AddClient({ practices }: { practices: PracticeOption[] }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [clientGroupId, setClientGroupId] = useState('');
  const [result, setResult] = useState<AccessResult | null>(null);
  const [pending, startTransition] = useTransition();

  const chosen = practices.find((practice) => practice.id === clientGroupId);

  function submit() {
    setResult(null);
    startTransition(async () => {
      const outcome = await addClientLogin({ email, fullName, clientGroupId });
      setResult(outcome);
      if (outcome.ok) {
        setEmail('');
        setFullName('');
        setClientGroupId('');
      }
    });
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Building2 size={15} /> Add client
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-fg">Add a client login</h2>
      <p className="mt-1 text-xs text-fg-subtle">
        For a practice, not a teammate. Signing in takes them straight to their
        own portal and nowhere else in the Hub.
      </p>

      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-fg-muted">
          Practice
        </span>
        <select
          value={clientGroupId}
          onChange={(event) => setClientGroupId(event.target.value)}
          className={inputClass}
        >
          <option value="">Choose a practice…</option>
          {practices.map((practice) => (
            <option key={practice.id} value={practice.id}>
              {practice.name}
              {practice.portalEnabled ? '' : ' — portal off'}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">
            Their name
          </span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Dr Amara Osei"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">
            Their email
          </span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="amara@thedentalpractice.co.uk"
            className={inputClass}
          />
        </label>
      </div>

      {/*
        Said before the login is made rather than after. The account would be
        correct and the link would still land on a refusal, which reads as a
        broken link rather than a switched-off portal.
      */}
      {chosen && !chosen.portalEnabled ? (
        <p className="mt-3 rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning">
          {chosen.name}&rsquo;s portal is switched off, so this login will be
          turned away until it is enabled on Client Portal. The account itself
          will be set up correctly.
        </p>
      ) : null}

      {result ? (
        <p
          className={cn(
            'mt-3 text-xs',
            result.ok ? 'text-positive' : 'text-negative',
          )}
        >
          {result.message}
        </p>
      ) : null}

      {result?.link ? <SetPasswordLink url={result.link} /> : null}

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="primary"
          onClick={submit}
          disabled={pending || clientGroupId === ''}
        >
          {pending ? 'Adding…' : 'Add client login'}
        </Button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="rounded-md px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
