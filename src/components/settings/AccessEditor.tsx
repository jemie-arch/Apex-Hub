'use client';

import { KeyRound } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  setPermissions,
  type AccessResult,
} from '@/app/(app)/settings/access/actions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  type PermissionKey,
} from '@/config/permissions';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';

export interface AccessUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

/** Grouped the same way the sidebar is, so granting maps to what people see. */
const GROUPS: Array<{ heading: string; keys: PermissionKey[] }> = [
  {
    heading: 'B2B — winning clients',
    keys: ['pipeline', 'b2b_leads', 'sales_tracker', 'b2b_ads'],
  },
  {
    heading: 'Clients — serving them',
    keys: [
      'overview',
      'onboarding',
      'client_management',
      'ads_management',
      'compare',
    ],
  },
  { heading: 'Patients', keys: ['consultations', 'calls'] },
  {
    heading: 'Company',
    keys: ['meetings', 'projects', 'hr', 'tech_support', 'forms', 'finance'],
  },
  { heading: 'Account', keys: ['account', 'access', 'settings'] },
];

export function AccessEditor({ user }: { user: AccessUser }) {
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState<string[]>(user.permissions);
  const [result, setResult] = useState<AccessResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(key: PermissionKey) {
    setKeys((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key],
    );
  }

  return (
    <>
      <Button size="sm" icon={<KeyRound size={13} />} onClick={() => setOpen(true)}>
        {formatCount(user.permissions.length)} / {PERMISSION_KEYS.length}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={user.name}
        subtitle={`${user.email} · which pages appear in their sidebar`}
        size="lg"
        footer={
          <>
            <Button onClick={() => setKeys([...PERMISSION_KEYS])}>
              Select all
            </Button>
            <Button onClick={() => setKeys([])}>Clear</Button>
            <Button
              variant="primary"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setResult(await setPermissions({ userId: user.id, keys }));
                })
              }
            >
              {isPending ? 'Saving…' : 'Save access'}
            </Button>
          </>
        }
      >
        {result ? (
          <p
            className={cn(
              'mb-4 rounded-md px-3 py-2 text-sm',
              result.ok
                ? 'bg-positive-subtle text-positive'
                : 'bg-negative-subtle text-negative',
            )}
          >
            {result.message}
          </p>
        ) : null}

        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => (
            <fieldset key={group.heading}>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                {group.heading}
              </legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {group.keys.map((key) => (
                  <label
                    key={key}
                    className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2 text-sm text-fg"
                  >
                    <input
                      type="checkbox"
                      checked={keys.includes(key)}
                      onChange={() => toggle(key)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">
                        {PERMISSION_LABELS[key]}
                      </span>
                      <span className="block font-mono text-[10px] text-fg-subtle">
                        {key}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        <p className="mt-5 text-xs text-fg-subtle">
          The key under each label is what gets stored. Labels can be renamed
          freely; a key never should be — renaming one silently revokes that
          page for everybody who had it.
        </p>
      </Modal>
    </>
  );
}
