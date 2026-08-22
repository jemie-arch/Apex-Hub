'use client';

/**
 * Adds a teammate: a login, a job role, the pages they start with, and a link
 * for them to choose their own password.
 *
 * The link comes back here rather than going out by email. Two reasons: a
 * message under the company's name is your decision and not this form's, and
 * nobody ever has to invent a password on someone else's behalf or type one
 * into a chat window.
 */
import { UserPlus } from 'lucide-react';
import { useState, useTransition } from 'react';

import { addTeammate, type AccessResult } from '@/app/(app)/settings/access/actions';
import { SetPasswordLink } from '@/components/settings/SetPasswordLink';
import { Button } from '@/components/ui/Button';
import {
  ASSIGNABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type UserRole,
} from '@/config/roles';
import { PERMISSION_KEYS, PERMISSION_LABELS } from '@/config/permissions';
import { cn } from '@/lib/cn';

/**
 * What each role gets on day one, so nobody arrives at an empty sidebar.
 *
 * A starting point, not a rule — every key stays editable per person on the
 * table below. A privileged role gets everything because it reaches everything
 * anyway; withholding menu items from someone who can type the URL would only
 * be theatre.
 */
const STARTER_KEYS: Record<UserRole, readonly string[]> = {
  super_admin: PERMISSION_KEYS,
  admin: PERMISSION_KEYS,
  ceo: [
    'pipeline', 'b2b_leads', 'sales_tracker', 'b2b_ads', 'overview',
    'client_management', 'compare', 'fulfilment', 'billing', 'finance', 'hr',
    'meetings', 'account',
  ],
  media_buyer: [
    'ads_management', 'b2b_ads', 'compare', 'fulfilment', 'overview',
    'client_management', 'account',
  ],
  tech: [
    'tech_support', 'forms', 'projects', 'settings', 'client_management',
    'overview', 'account',
  ],
  isa: ['calls', 'consultations', 'overview', 'account'],
  csm: [
    'client_management', 'onboarding', 'onboarding_forms', 'fulfilment',
    'compare', 'overview', 'consultations', 'account',
  ],
  isr: ['calls', 'account'],
  csr: ['client_management', 'account'],
  client: [],
};

export function AddTeammate({ callerRole }: { callerRole: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('csm');
  const [result, setResult] = useState<AccessResult | null>(null);
  const [pending, startTransition] = useTransition();

  const roles = ASSIGNABLE_ROLES.filter(
    (option) => option !== 'super_admin' || callerRole === 'super_admin',
  );

  const starter = STARTER_KEYS[role];

  function submit() {
    setResult(null);
    startTransition(async () => {
      const outcome = await addTeammate({
        email,
        fullName,
        role,
        keys: [...starter],
      });
      setResult(outcome);
      if (outcome.ok) {
        setEmail('');
        setFullName('');
      }
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <UserPlus size={15} /> Add teammate
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-fg">Add a teammate</h2>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">
            Full name
          </span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Maria Santos"
            className="w-full rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 text-sm text-fg"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">
            Work email
          </span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="maria@apexdentalmarketing.net"
            className="w-full rounded-md border border-line bg-surface-sunken px-2.5 py-1.5 text-sm text-fg"
          />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-medium text-fg-muted">Role</legend>
        <div className="flex flex-wrap gap-2">
          {roles.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRole(option)}
              title={ROLE_DESCRIPTIONS[option]}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                role === option
                  ? 'border-accent bg-accent-subtle font-medium text-accent'
                  : 'border-line text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              {ROLE_LABELS[option]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-fg-subtle">{ROLE_DESCRIPTIONS[role]}</p>
      </fieldset>

      <div className="mt-4 rounded-md border border-line bg-surface-sunken p-3">
        <p className="text-xs font-medium text-fg-muted">
          Starts with {starter.length} page
          {starter.length === 1 ? '' : 's'}
        </p>
        <p className="mt-1 text-xs text-fg-subtle">
          {starter.length === 0
            ? 'No pages. Grant them some in the table below.'
            : starter
                .map((key) => PERMISSION_LABELS[key as keyof typeof PERMISSION_LABELS] ?? key)
                .join(' · ')}
        </p>
      </div>

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
        <Button onClick={submit} disabled={pending}>
          {pending ? 'Adding…' : 'Add teammate'}
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
