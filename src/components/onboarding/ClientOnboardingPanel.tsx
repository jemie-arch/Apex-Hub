'use client';

/**
 * What sits behind a card on the Client Onboarding board.
 *
 * Two columns, as asked for. The left is what we know about the practice,
 * including every form they have submitted with its answers. The right is what
 * we are doing about it: notes, the trail of what happened, and the checklist.
 *
 * The forms are shown as their real answers rather than a link out to
 * GoHighLevel, because the reason this board exists is so a CSM does not have to
 * go and look somewhere else.
 */
import { CheckCircle2, Circle, ExternalLink, Sparkles, X } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  addOnboardingNote,
  setCsm,
  setOnboardingHold,
  setOnboardingStep,
  type BoardResult,
} from '@/app/(app)/onboarding/clients/actions';
import type {
  BoardActivity,
  BoardForm,
  BoardGroup,
  BoardNote,
  BoardStaff,
  BoardStep,
  BoardStepState,
} from '@/components/onboarding/ClientOnboardingBoard';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  KICKOFF_FORM_URL,
  ONBOARDING_FORM_LABELS,
  STATUS_LABELS,
  type OnboardingStatus,
} from '@/config/onboarding';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';

type Tab = 'notes' | 'activity' | 'steps';

function when(iso: string | null): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

/** Answers worth reading, with the noise the form builder adds stripped out. */
function answersOf(payload: unknown): Array<[string, string]> {
  if (payload === null || typeof payload !== 'object') return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => value !== null && String(value).trim() !== '')
    .map(([key, value]) => [key, String(value)] as [string, string]);
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-fg">
        {value === null || value.trim() === '' ? (
          <span className="text-fg-subtle">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export function ClientOnboardingPanel({
  group,
  staff,
  steps,
  stepState,
  forms,
  notes,
  activity,
  onClose,
}: {
  group: BoardGroup;
  staff: BoardStaff[];
  steps: BoardStep[];
  stepState: BoardStepState[];
  forms: BoardForm[];
  notes: BoardNote[];
  activity: BoardActivity[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('steps');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<BoardResult | null>(null);
  const [pending, startTransition] = useTransition();

  const stateByKey = new Map(stepState.map((row) => [row.step_key, row]));
  const doneCount = stepState.filter((row) => row.done_at !== null).length;
  const held =
    group.onboarding_status === 'waiting_on_team' ||
    group.onboarding_status === 'waiting_on_client';

  function run(action: () => Promise<BoardResult>) {
    setResult(null);
    startTransition(async () => {
      setResult(await action());
    });
  }

  const groupedSteps = steps.reduce<Map<string, BoardStep[]>>((acc, step) => {
    const list = acc.get(step.group_label) ?? [];
    list.push(step);
    acc.set(step.group_label, list);
    return acc;
  }, new Map());

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`${group.name} onboarding`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-6xl rounded-lg border border-line bg-bg shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-fg">
              {group.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusPill
                value={STATUS_LABELS[group.onboarding_status as OnboardingStatus] ?? group.onboarding_status}
                tone={
                  group.onboarding_status === 'launch_ready'
                    ? 'positive'
                    : held
                      ? 'warning'
                      : 'accent'
                }
              />
              <span className="text-xs text-fg-subtle">
                {doneCount} of {steps.length} steps done
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <X size={16} />
          </button>
        </header>

        <div className="grid grid-cols-1 gap-0 lg:grid-cols-2">
          {/* Left: everything we know. */}
          <div className="max-h-[70vh] overflow-y-auto border-line p-5 lg:border-r">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Company" value={group.name} />
              <Field label="Client" value={group.contact_name} />
              <Field label="Email" value={group.contact_email} />
              <Field label="Phone" value={group.contact_phone} />
              <Field label="Website" value={group.website} />
              <Field
                label="Retainer"
                value={group.retainer_cents > 0 ? formatMoney(group.retainer_cents) : null}
              />
              <Field label="Onboarding call" value={when(group.onboarding_call_at)} />
              <Field label="Launch call" value={when(group.launch_call_at)} />
              <Field label="Signed" value={group.signed_on} />
              <Field label="Added to board" value={when(group.onboarding_added_at)} />
              <Field
                label="Treatments"
                value={group.treatments.length > 0 ? group.treatments.join(', ') : null}
              />
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
                  CSM
                </dt>
                <dd className="mt-0.5">
                  <select
                    value={group.csm_user_id ?? ''}
                    disabled={pending}
                    onChange={(event) =>
                      run(() =>
                        setCsm({
                          groupId: group.id,
                          userId: event.target.value === '' ? null : event.target.value,
                        }),
                      )
                    }
                    className="w-full rounded-md border border-line bg-surface-sunken px-2 py-1 text-sm text-fg"
                  >
                    <option value="">Unassigned</option>
                    {staff.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.full_name ?? person.email}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap gap-2">
              {held ? (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    run(() => setOnboardingHold({ groupId: group.id, status: null }))
                  }
                >
                  Release hold
                </Button>
              ) : null}
              {(['waiting_on_team', 'waiting_on_client'] as const).map((status) =>
                group.onboarding_status === status ? null : (
                  <Button
                    key={status}
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      run(() => setOnboardingHold({ groupId: group.id, status }))
                    }
                  >
                    {STATUS_LABELS[status]}
                  </Button>
                ),
              )}
            </div>

            <h3 className="mt-6 text-sm font-semibold text-fg">Forms submitted</h3>
            {forms.length === 0 ? (
              <p className="mt-1 text-xs text-fg-subtle">
                Nothing on file. A form appears here the moment it is submitted.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {forms.map((form) => {
                  const answers = answersOf(form.payload);

                  return (
                    <details
                      key={form.id}
                      className="rounded-md border border-line bg-surface"
                    >
                      <summary className="cursor-pointer px-3 py-2 text-xs hover:bg-surface-hover">
                        <span className="font-medium text-fg">
                          {ONBOARDING_FORM_LABELS[form.form_key] ?? form.form_key}
                        </span>
                        <span className="ml-2 text-fg-subtle">
                          {when(form.submitted_at)} · {answers.length} answers
                        </span>
                      </summary>
                      <dl className="space-y-2 border-t border-line px-3 py-2">
                        {form.person_name ? (
                          <Field label="Submitted by" value={form.person_name} />
                        ) : null}
                        {answers.map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-[11px] font-medium text-fg-subtle">
                              {label}
                            </dt>
                            <dd className="whitespace-pre-wrap text-xs text-fg">
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: what we are doing about it. */}
          <div className="flex max-h-[70vh] flex-col">
            <nav className="flex gap-1 border-b border-line px-4 pt-3">
              {(
                [
                  ['steps', 'Onboarding steps'],
                  ['notes', 'Notes'],
                  ['activity', 'Activity'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    'rounded-t-md px-3 py-2 text-xs transition-colors',
                    tab === key
                      ? 'border-b-2 border-accent font-medium text-accent'
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="flex-1 overflow-y-auto p-4">
              {result ? (
                <p
                  className={cn(
                    'mb-3 text-xs',
                    result.ok ? 'text-positive' : 'text-negative',
                  )}
                >
                  {result.message}
                </p>
              ) : null}

              {tab === 'steps' ? (
                <div className="space-y-5">
                  {[...groupedSteps.entries()].map(([groupLabel, list]) => (
                    <section key={groupLabel}>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                        {groupLabel}
                      </h4>
                      <ul className="space-y-1">
                        {list.map((step) => {
                          const state = stateByKey.get(step.step_key);
                          const isDone = state?.done_at != null;
                          const isAdsCopy = step.step_key === 'ads_copy';

                          return (
                            <li key={step.step_key}>
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() =>
                                    run(() =>
                                      setOnboardingStep({
                                        groupId: group.id,
                                        stepKey: step.step_key,
                                        isDone: !isDone,
                                        assetUrl: state?.asset_url ?? undefined,
                                      }),
                                    )
                                  }
                                  className="mt-0.5 shrink-0 text-fg-subtle transition-colors hover:text-accent disabled:opacity-50"
                                  aria-pressed={isDone}
                                >
                                  {isDone ? (
                                    <CheckCircle2 size={15} className="text-positive" />
                                  ) : (
                                    <Circle size={15} />
                                  )}
                                </button>

                                <div className="min-w-0 flex-1">
                                  <p
                                    className={cn(
                                      'text-sm',
                                      isDone
                                        ? 'text-fg-subtle line-through'
                                        : 'text-fg',
                                    )}
                                  >
                                    {step.label}
                                    {step.automated ? (
                                      <span
                                        title="Meant to be automated. Until that exists, somebody still has to do it and tick it."
                                        className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-surface-sunken px-1 py-0.5 text-[10px] text-fg-subtle"
                                      >
                                        <Sparkles size={9} /> auto
                                      </span>
                                    ) : null}
                                  </p>

                                  {isAdsCopy ? (
                                    <AdsCopyLink
                                      groupId={group.id}
                                      current={state?.asset_url ?? ''}
                                      isDone={isDone}
                                      disabled={pending}
                                      onSave={(url) =>
                                        run(() =>
                                          setOnboardingStep({
                                            groupId: group.id,
                                            stepKey: step.step_key,
                                            isDone,
                                            assetUrl: url,
                                          }),
                                        )
                                      }
                                    />
                                  ) : null}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}

                  <p className="border-t border-line pt-3 text-xs text-fg-subtle">
                    When every step is ticked the practice moves to Launch ready on
                    its own. That is why Launch ready is not a button.
                  </p>
                </div>
              ) : null}

              {tab === 'notes' ? (
                <div>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    placeholder="What happened, and what it means for the launch date."
                    className="w-full rounded-md border border-line bg-surface-sunken px-2.5 py-2 text-sm text-fg"
                  />
                  <Button
                    className="mt-2"
                    disabled={pending || note.trim() === ''}
                    onClick={() =>
                      run(async () => {
                        const outcome = await addOnboardingNote({
                          groupId: group.id,
                          body: note,
                        });
                        if (outcome.ok) setNote('');
                        return outcome;
                      })
                    }
                  >
                    Add note
                  </Button>

                  <div className="mt-4 space-y-3">
                    {notes.length === 0 ? (
                      <p className="text-xs text-fg-subtle">No notes yet.</p>
                    ) : (
                      notes.map((row) => (
                        <div
                          key={row.id}
                          className="rounded-md border border-line bg-surface p-3"
                        >
                          <p className="whitespace-pre-wrap text-sm text-fg">
                            {row.body}
                          </p>
                          <p className="mt-1.5 text-[11px] text-fg-subtle">
                            {row.author_name ?? 'Someone'} · {when(row.created_at)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {tab === 'activity' ? (
                <ol className="space-y-3">
                  {activity.length === 0 ? (
                    <p className="text-xs text-fg-subtle">
                      Nothing recorded yet. Every status change, step and note lands
                      here from now on.
                    </p>
                  ) : (
                    activity.map((row) => (
                      <li key={row.id} className="flex gap-2.5">
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="text-sm text-fg">{row.detail}</p>
                          <p className="text-[11px] text-fg-subtle">
                            {row.actor_name ?? 'Automatic'} · {when(row.created_at)}
                          </p>
                        </div>
                      </li>
                    ))
                  )}
                </ol>
              ) : null}
            </div>

            <footer className="border-t border-line px-4 py-3">
              <a
                href={KICKOFF_FORM_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
              >
                <ExternalLink size={12} /> Submit the kick off form
              </a>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The ads copy the client reviews in their portal.
 *
 * A link rather than a file for now, which is also how creative is usually
 * shared — Drive, Frame.io, a Canva share. It is stored on the step so the
 * portal can show whatever is current without a second table.
 */
function AdsCopyLink({
  current,
  isDone,
  disabled,
  onSave,
}: {
  groupId: string;
  current: string;
  isDone: boolean;
  disabled: boolean;
  onSave: (url: string) => void;
}) {
  const [url, setUrl] = useState(current);

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1.5">
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://… link to the copy for the client to review"
          className="min-w-0 flex-1 rounded border border-line bg-surface-sunken px-2 py-1 text-xs text-fg"
        />
        <button
          type="button"
          disabled={disabled || url.trim() === current.trim()}
          onClick={() => onSave(url)}
          className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50"
        >
          Save
        </button>
      </div>
      {current ? (
        <a
          href={current}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
        >
          <ExternalLink size={10} /> {isDone ? 'Shared with the client' : 'Preview'}
        </a>
      ) : null}
    </div>
  );
}
