'use client';

/**
 * Admin editor for a business and its sub-accounts.
 *
 * Everything here is human-owned: the syncs fill blanks but never overwrite
 * these, which is why they are worth typing. Two fields do real work elsewhere
 * and are labelled to say so — ad account id feeds the spend sync, and the
 * signed date is what the client target counts.
 */
import { Pencil } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  moveLocationToGroup,
  updateClientGroup,
  updateLocation,
  type SaveResult,
} from '@/app/(app)/clients/[id]/actions';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { tenant, titleCase } from '@/config/tenant.config';
import { cn } from '@/lib/cn';
import type { ClientGroupRow, ClientRow } from '@/types/database';

const STATUSES = ['onboarding', 'active', 'paused', 'churned'] as const;

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-fg-subtle">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  'mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg';

export function ClientEditor({
  group,
  locations,
  otherGroups,
  stages,
}: {
  group: ClientGroupRow;
  locations: ClientRow[];
  otherGroups: Array<{ id: string; name: string }>;
  stages: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const client = tenant.vocabulary.client;
  const location = tenant.vocabulary.location;

  function onSaveGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      setResult(
        await updateClientGroup({
          groupId: group.id,
          name: String(form.get('name') ?? ''),
          status: String(form.get('status') ?? 'onboarding'),
          onboardingStage: String(form.get('onboarding_stage') ?? ''),
          retainer: String(form.get('retainer') ?? '0'),
          currency: String(form.get('currency') ?? 'USD'),
          treatments: String(form.get('treatments') ?? ''),
          contactName: String(form.get('contact_name') ?? ''),
          contactEmail: String(form.get('contact_email') ?? ''),
          contactPhone: String(form.get('contact_phone') ?? ''),
          website: String(form.get('website') ?? ''),
          signedOn: String(form.get('signed_on') ?? ''),
          startedOn: String(form.get('started_on') ?? ''),
          portalEnabled: form.get('portal_enabled') === 'on',
        }),
      );
    });
  }

  function onSaveLocation(
    event: React.FormEvent<HTMLFormElement>,
    locationId: string,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    startTransition(async () => {
      setResult(
        await updateLocation({
          locationId,
          groupId: group.id,
          name: String(form.get('loc_name') ?? ''),
          adAccountId: String(form.get('ad_account_id') ?? ''),
          timezone: String(form.get('timezone') ?? 'UTC'),
          schedulingType: String(form.get('scheduling_type') ?? ''),
          areaCode: String(form.get('area_code') ?? ''),
          isActive: form.get('is_active') === 'on',
        }),
      );
    });
  }

  return (
    <>
      <Button size="sm" icon={<Pencil size={13} />} onClick={() => setOpen(true)}>
        Edit
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={group.name}
        subtitle={`${titleCase(client.singular)} settings — these fields are never overwritten by a sync`}
        size="lg"
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

        <form onSubmit={onSaveGroup} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input name="name" defaultValue={group.name} className={inputClass} />
            </Field>

            <Field label="Status" hint="Only active counts toward the target.">
              <select
                name="status"
                defaultValue={group.status}
                className={inputClass}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Onboarding stage">
              <select
                name="onboarding_stage"
                defaultValue={group.onboarding_stage}
                className={inputClass}
              >
                {[...new Set([...stages, group.onboarding_stage])].map((stage) => (
                  <option key={stage} value={stage}>
                    {stage.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Retainer" hint="Monthly, in whole currency units.">
              <input
                name="retainer"
                inputMode="decimal"
                defaultValue={String(group.retainer_cents / 100)}
                className={inputClass}
              />
            </Field>

            <Field label="Currency">
              <input
                name="currency"
                defaultValue={group.currency}
                maxLength={3}
                className={inputClass}
              />
            </Field>

            <Field
              label="Treatments"
              hint="Comma separated, e.g. ortho, general."
            >
              <input
                name="treatments"
                defaultValue={(group.treatments ?? []).join(', ')}
                className={inputClass}
              />
            </Field>

            <Field
              label="Signed on"
              hint="Counted by the client target. Leave blank if unknown."
            >
              <input
                type="date"
                name="signed_on"
                defaultValue={group.signed_on ?? ''}
                className={inputClass}
              />
            </Field>

            <Field label="Started on">
              <input
                type="date"
                name="started_on"
                defaultValue={group.started_on ?? ''}
                className={inputClass}
              />
            </Field>

            <Field label="Contact name">
              <input
                name="contact_name"
                defaultValue={group.contact_name ?? ''}
                className={inputClass}
              />
            </Field>

            <Field label="Contact email">
              <input
                name="contact_email"
                type="email"
                defaultValue={group.contact_email ?? ''}
                className={inputClass}
              />
            </Field>

            <Field label="Contact phone">
              <input
                name="contact_phone"
                defaultValue={group.contact_phone ?? ''}
                className={inputClass}
              />
            </Field>

            <Field label="Website">
              <input
                name="website"
                defaultValue={group.website ?? ''}
                className={inputClass}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              name="portal_enabled"
              defaultChecked={group.portal_enabled}
            />
            Portal link active
          </label>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? 'Saving…' : `Save ${client.singular}`}
            </Button>
          </div>
        </form>

        <hr className="my-6 border-line" />

        <h3 className="text-sm font-semibold text-fg">
          {titleCase(location.plural)}
        </h3>
        <p className="mb-4 mt-0.5 text-xs text-fg-subtle">
          One row per CRM sub-account. The ad account id is what the spend sync
          matches on — without it, that {location.singular} is skipped.
        </p>

        {locations.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No {location.plural} linked. They arrive from the CRM sync.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {locations.map((row) => (
              <form
                key={row.id}
                onSubmit={(event) => onSaveLocation(event, row.id)}
                className="rounded-lg border border-line p-4"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Name">
                    <input
                      name="loc_name"
                      defaultValue={row.name}
                      className={inputClass}
                    />
                  </Field>

                  <Field
                    label="Ad account id"
                    hint="Digits only; act_ prefix is stripped."
                  >
                    <input
                      name="ad_account_id"
                      defaultValue={row.ad_account_id ?? ''}
                      placeholder="655516055301657"
                      className={inputClass}
                    />
                  </Field>

                  <Field
                    label="Timezone"
                    hint="Where appointment times render for this site."
                  >
                    <input
                      name="timezone"
                      defaultValue={row.timezone}
                      placeholder="America/Chicago"
                      className={inputClass}
                    />
                  </Field>

                  <Field label="Scheduling type">
                    <input
                      name="scheduling_type"
                      defaultValue={row.scheduling_type ?? ''}
                      className={inputClass}
                    />
                  </Field>

                  <Field label="Area code">
                    <input
                      name="area_code"
                      defaultValue={row.area_code ?? ''}
                      className={inputClass}
                    />
                  </Field>

                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        name="is_active"
                        defaultChecked={row.is_active}
                      />
                      Active
                    </label>
                  </div>
                </div>

                <p className="mt-3 font-mono text-xs text-fg-subtle">
                  CRM location: {row.crm_location_id ?? 'not linked'}
                </p>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <MoveLocation
                    locationId={row.id}
                    fromGroupId={group.id}
                    otherGroups={otherGroups}
                    onDone={setResult}
                  />
                  <Button type="submit" size="sm" disabled={isPending}>
                    {isPending ? 'Saving…' : `Save ${location.singular}`}
                  </Button>
                </div>
              </form>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * The manual merge. The CRM sync gives every new sub-account its own business
 * because guessing which ones share a practice would file one practice's
 * revenue under another; this is where a human says so.
 */
function MoveLocation({
  locationId,
  fromGroupId,
  otherGroups,
  onDone,
}: {
  locationId: string;
  fromGroupId: string;
  otherGroups: Array<{ id: string; name: string }>;
  onDone: (result: SaveResult) => void;
}) {
  const [target, setTarget] = useState('');
  const [isPending, startTransition] = useTransition();

  if (otherGroups.length === 0) return <span />;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={target}
        aria-label="Move to another business"
        onChange={(event) => setTarget(event.target.value)}
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-fg"
      >
        <option value="">Move to…</option>
        {otherGroups.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>

      <Button
        type="button"
        size="sm"
        disabled={target === '' || isPending}
        onClick={() =>
          startTransition(async () => {
            onDone(
              await moveLocationToGroup({
                locationId,
                fromGroupId,
                toGroupId: target,
                // Merging usually means the auto-created business it came from
                // is now empty and pointless, so clear it up.
                deleteEmptySource: true,
              }),
            );
          })
        }
      >
        Merge
      </Button>
    </div>
  );
}
