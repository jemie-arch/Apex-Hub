'use client';

/**
 * Six columns, and a panel behind each card.
 *
 * The card shows six things and no more — company, client, CSM, the two calls
 * and when it arrived. Everything else is one click away rather than crammed
 * onto a tile, because a board is for seeing where forty practices are, and a
 * tile carrying twenty fields shows you nothing at a glance.
 */
import { CalendarClock, ExternalLink, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ClientOnboardingPanel } from '@/components/onboarding/ClientOnboardingPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  ONBOARDING_STATUSES,
  STATUS_HINTS,
  STATUS_LABELS,
  type OnboardingStatus,
} from '@/config/onboarding';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';

export interface BoardGroup {
  id: string;
  name: string;
  status: string;
  onboarding_status: string;
  onboarding_added_at: string;
  csm_user_id: string | null;
  onboarding_call_at: string | null;
  launch_call_at: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  retainer_cents: number;
  treatments: string[];
  signed_on: string | null;
  started_on: string | null;
  portal_token: string;
  portal_enabled: boolean;
  status_set_manually_at: string | null;
}

export interface BoardStaff {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

export interface BoardStep {
  step_key: string;
  group_key: string;
  group_label: string;
  label: string;
  automated: boolean;
  sort_order: number;
}

export interface BoardStepState {
  client_group_id: string;
  step_key: string;
  done_at: string | null;
  done_by: string | null;
  note: string | null;
  asset_url: string | null;
}

export interface BoardForm {
  id: string;
  client_group_id: string | null;
  form_key: string;
  clinic_name: string | null;
  person_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  stripe_customer_id: string | null;
  submitted_at: string;
  payload: unknown;
  match_method: string | null;
}

export interface BoardNote {
  id: string;
  client_group_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface BoardActivity {
  id: string;
  client_group_id: string;
  kind: string;
  detail: string;
  actor_name: string | null;
  created_at: string;
}

/** A date the way somebody scanning a board wants it: short and unambiguous. */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function shortDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

const COLUMN_TONE: Record<OnboardingStatus, string> = {
  new_signup: 'border-t-accent',
  onboarding_form: 'border-t-accent',
  kickoff_form: 'border-t-accent',
  waiting_on_team: 'border-t-warning',
  waiting_on_client: 'border-t-warning',
  launch_ready: 'border-t-positive',
};

export function ClientOnboardingBoard({
  groups,
  staff,
  steps,
  stepState,
  forms,
  notes,
  activity,
}: {
  groups: BoardGroup[];
  staff: BoardStaff[];
  steps: BoardStep[];
  stepState: BoardStepState[];
  forms: BoardForm[];
  notes: BoardNote[];
  activity: BoardActivity[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const staffById = useMemo(
    () => new Map(staff.map((person) => [person.id, person])),
    [staff],
  );

  const doneCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of stepState) {
      if (row.done_at === null) continue;
      counts.set(row.client_group_id, (counts.get(row.client_group_id) ?? 0) + 1);
    }
    return counts;
  }, [stepState]);

  const byStatus = useMemo(() => {
    const map = new Map<string, BoardGroup[]>();
    for (const status of ONBOARDING_STATUSES) map.set(status, []);
    for (const group of groups) {
      const bucket = map.get(group.onboarding_status);
      if (bucket) bucket.push(group);
    }
    return map;
  }, [groups]);

  const open = openId ? groups.find((group) => group.id === openId) ?? null : null;

  if (groups.length === 0) {
    return (
      <EmptyState
        title="No practices yet"
        description="A client appears here as soon as their New Client form arrives."
        icon={<Users size={22} />}
      />
    );
  }

  return (
    <>
      <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-4">
        {ONBOARDING_STATUSES.map((status) => {
          const column = byStatus.get(status) ?? [];

          return (
            <section
              key={status}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-lg border border-line border-t-2 bg-surface',
                COLUMN_TONE[status],
              )}
            >
              <header className="border-b border-line px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-xs font-semibold text-fg">
                    {STATUS_LABELS[status]}
                  </h2>
                  <span className="numeric text-xs text-fg-subtle">
                    {formatCount(column.length)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-fg-subtle">
                  {STATUS_HINTS[status]}
                </p>
              </header>

              <div className="flex-1 space-y-2 p-2">
                {column.length === 0 ? (
                  <p className="px-1 py-3 text-[11px] text-fg-subtle">Nobody here.</p>
                ) : (
                  column.map((group) => {
                    const csm = group.csm_user_id
                      ? staffById.get(group.csm_user_id)
                      : null;
                    const finished = doneCount.get(group.id) ?? 0;

                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setOpenId(group.id)}
                        className="w-full rounded-md border border-line bg-surface-sunken p-2.5 text-left transition-colors hover:border-accent hover:bg-surface-hover"
                      >
                        <p className="truncate text-sm font-medium text-fg">
                          {group.name}
                        </p>

                        <p className="mt-0.5 truncate text-xs text-fg-muted">
                          {group.contact_name ?? (
                            <span className="text-fg-subtle">no client name</span>
                          )}
                        </p>

                        <dl className="mt-2 space-y-1 text-[11px]">
                          <div className="flex justify-between gap-2">
                            <dt className="text-fg-subtle">CSM</dt>
                            <dd className="truncate text-fg-muted">
                              {csm
                                ? (csm.full_name ?? csm.email)
                                : 'unassigned'}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-fg-subtle">Onboarding call</dt>
                            <dd className="text-fg-muted">
                              {shortDateTime(group.onboarding_call_at) ?? '—'}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-fg-subtle">Launch call</dt>
                            <dd className="text-fg-muted">
                              {shortDateTime(group.launch_call_at) ?? '—'}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-fg-subtle">Added</dt>
                            <dd className="text-fg-muted">
                              {shortDate(group.onboarding_added_at) ?? '—'}
                            </dd>
                          </div>
                        </dl>

                        {steps.length > 0 ? (
                          <div className="mt-2 flex items-center gap-1.5">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  finished >= steps.length
                                    ? 'bg-positive'
                                    : 'bg-accent',
                                )}
                                style={{
                                  width: `${Math.round((finished / steps.length) * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="numeric text-[10px] text-fg-subtle">
                              {finished}/{steps.length}
                            </span>
                          </div>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-subtle">
        <CalendarClock size={12} />
        Onboarding and launch calls come from the ADM Client Onboarding
        sub-account. A call booked there appears here once the calls sync has run.
        <ExternalLink size={12} className="opacity-0" />
      </p>

      {open ? (
        <ClientOnboardingPanel
          group={open}
          staff={staff}
          steps={steps}
          stepState={stepState.filter((row) => row.client_group_id === open.id)}
          forms={forms.filter((row) => row.client_group_id === open.id)}
          notes={notes.filter((row) => row.client_group_id === open.id)}
          activity={activity.filter((row) => row.client_group_id === open.id)}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </>
  );
}
