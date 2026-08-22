'use client';

/**
 * Every practice in onboarding, as one list grouped by status.
 *
 * A list rather than columns. Six columns of cards forces horizontal scrolling
 * and lets each card show only what fits in 18rem — which meant the two call
 * dates, the thing a CSM actually chases, were the first casualties. In rows the
 * same six fields line up so forty practices can be compared down a column
 * instead of hunted across tiles.
 *
 * Grouped rather than sorted, because the status is the question being asked.
 */
import { CalendarClock, ChevronRight, Users } from 'lucide-react';
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

/** A stripe down the left of each group, so status reads without the label. */
const STATUS_STRIPE: Record<OnboardingStatus, string> = {
  new_signup: 'bg-chart-6',
  onboarding_form: 'bg-accent',
  kickoff_form: 'bg-chart-5',
  waiting_on_team: 'bg-warning',
  waiting_on_client: 'bg-warning',
  launch_ready: 'bg-positive',
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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
      map.get(group.onboarding_status)?.push(group);
    }
    // Oldest first inside a group: the practice waiting longest is the one to
    // ring, and burying it at the bottom of a list is how it gets forgotten.
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.onboarding_added_at).getTime() -
          new Date(b.onboarding_added_at).getTime(),
      );
    }
    return map;
  }, [groups]);

  const open = openId ? groups.find((group) => group.id === openId) ?? null : null;

  function toggle(status: string) {
    setCollapsed((was) => {
      const next = new Set(was);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

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
      <div className="space-y-4">
        {ONBOARDING_STATUSES.map((status) => {
          const rows = byStatus.get(status) ?? [];
          const isCollapsed = collapsed.has(status);

          return (
            <section
              key={status}
              className="surface-3d overflow-hidden rounded-lg border border-line bg-surface"
            >
              <button
                type="button"
                onClick={() => toggle(status)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
              >
                <span
                  className={cn('h-8 w-1 shrink-0 rounded-full', STATUS_STRIPE[status])}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-fg">
                      {STATUS_LABELS[status]}
                    </span>
                    <span className="numeric text-xs text-fg-subtle">
                      {formatCount(rows.length)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-fg-subtle">
                    {STATUS_HINTS[status]}
                  </span>
                </span>
                <ChevronRight
                  size={15}
                  className={cn(
                    'ml-auto shrink-0 text-fg-subtle transition-transform duration-200',
                    isCollapsed ? '' : 'rotate-90',
                  )}
                />
              </button>

              {isCollapsed || rows.length === 0 ? (
                rows.length === 0 && !isCollapsed ? (
                  <p className="border-t border-line px-4 py-3 text-xs text-fg-subtle">
                    Nobody at this status.
                  </p>
                ) : null
              ) : (
                <div className="overflow-x-auto border-t border-line">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                        <th className="px-4 py-2 font-medium">Company</th>
                        <th className="px-4 py-2 font-medium">Client</th>
                        <th className="px-4 py-2 font-medium">CSM</th>
                        <th className="px-4 py-2 font-medium">Onboarding call</th>
                        <th className="px-4 py-2 font-medium">Launch call</th>
                        <th className="px-4 py-2 font-medium">Added</th>
                        <th className="px-4 py-2 text-right font-medium">Steps</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((group) => {
                        const csm = group.csm_user_id
                          ? staffById.get(group.csm_user_id)
                          : null;
                        const finished = doneCount.get(group.id) ?? 0;
                        const pct =
                          steps.length === 0
                            ? 0
                            : Math.round((finished / steps.length) * 100);

                        return (
                          <tr
                            key={group.id}
                            onClick={() => setOpenId(group.id)}
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setOpenId(group.id);
                              }
                            }}
                            className="row-interactive cursor-pointer border-b border-line last:border-0 hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
                          >
                            <td className="px-4 py-2.5 font-medium text-fg">
                              {group.name}
                            </td>
                            <td className="px-4 py-2.5 text-fg-muted">
                              {group.contact_name ?? (
                                <span className="text-fg-subtle">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-fg-muted">
                              {csm ? (
                                (csm.full_name ?? csm.email)
                              ) : (
                                <span className="text-fg-subtle">unassigned</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-fg-muted">
                              {shortDateTime(group.onboarding_call_at) ?? (
                                <span className="text-fg-subtle">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-fg-muted">
                              {shortDateTime(group.launch_call_at) ?? (
                                <span className="text-fg-subtle">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-fg-muted">
                              {shortDate(group.onboarding_added_at) ?? '—'}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-2">
                                <div className="h-1 w-16 overflow-hidden rounded-full bg-chart-track">
                                  <div
                                    className={cn(
                                      'h-full rounded-full transition-all duration-500',
                                      finished >= steps.length && steps.length > 0
                                        ? 'bg-positive'
                                        : 'bg-accent',
                                    )}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="numeric text-xs text-fg-subtle">
                                  {finished}/{steps.length}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-fg-subtle">
        <CalendarClock size={12} />
        Onboarding and launch calls come from the ADM Client Onboarding
        sub-account. A call booked there appears here once the calls sync has run.
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
