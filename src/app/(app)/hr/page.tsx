import { UsersRound } from 'lucide-react';
import { redirect } from 'next/navigation';
import { isPrivileged, roleLabel } from '@/config/roles';

import {
  DecideTimeOff,
  EditEmployment,
  RequestTimeOff,
} from '@/components/team/TeamControls';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { humanise } from '@/lib/format';
import { currentCaller } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Team' };

/** Inclusive day count — a request for one day is one day, not zero. */
function days(startsOn: string, endsOn: string): number {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Team: who is here, what they do, and who is away.
 *
 * A non-admin sees the roster and their own requests. The decide buttons only
 * render for an admin — and the action behind them checks again, because a
 * hidden button is not a guard.
 */
export default async function TeamPage() {
  const caller = await currentCaller();
  if (!caller) redirect('/login');

  const isAdmin = isPrivileged(caller.role);
  const db = serviceClient();

  const [people, requests] = await Promise.all([
    db
      .from('user_profiles')
      .select('id, email, full_name, role, job_title, started_on')
      .neq('role', 'client')
      .order('started_on', { ascending: true, nullsFirst: false }),
    db
      .from('time_off_requests')
      .select(
        'id, user_id, kind, starts_on, ends_on, note, status, decided_at, decision_note',
      )
      .order('starts_on', { ascending: false })
      .limit(200),
  ]);

  if (people.error) throw people.error;
  if (requests.error) throw requests.error;

  const staff = people.data ?? [];
  const nameById = new Map(
    staff.map((row) => [row.id, row.full_name ?? row.email]),
  );

  // A non-admin only ever sees their own leave.
  const visible = (requests.data ?? []).filter(
    (row) => isAdmin || row.user_id === caller.id,
  );
  const pending = visible.filter((row) => row.status === 'pending');
  const decided = visible.filter((row) => row.status !== 'pending');

  return (
    <>
      <PageHeader
        title="Team"
        description="Roles, start dates and time off"
        actions={<RequestTimeOff />}
      />

      <section className="mb-8 overflow-hidden rounded-lg border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Job title</th>
                <th className="px-4 py-3 font-medium">Started</th>
                {isAdmin ? <th className="px-4 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {staff.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-line last:border-0 hover:bg-surface-hover"
                >
                  <td className="px-4 py-3">
                    <span className="block font-medium text-fg">
                      {row.full_name ?? row.email}
                    </span>
                    <span className="block text-xs text-fg-subtle">
                      {row.email}
                      {row.id === caller.id ? ' · you' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill
                      value={roleLabel(row.role)}
                      tone={isPrivileged(row.role) ? 'accent' : 'neutral'}
                    />
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {row.job_title ?? '—'}
                  </td>
                  <td className="numeric px-4 py-3 text-fg-muted">
                    {row.started_on ?? '—'}
                  </td>
                  {isAdmin ? (
                    <td className="px-4 py-3 text-right">
                      <EditEmployment
                        userId={row.id}
                        name={row.full_name ?? row.email}
                        jobTitle={row.job_title}
                        startedOn={row.started_on}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <h2 className="mb-3 text-sm font-semibold text-fg">
        Time off awaiting a decision
      </h2>
      {pending.length === 0 ? (
        <EmptyState
          title="Nothing pending"
          description={
            isAdmin
              ? 'Requests appear here as soon as somebody raises one.'
              : 'Your requests appear here until an admin decides them.'
          }
          icon={<UsersRound size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <tbody>
              {pending.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <span className="block font-medium text-fg">
                      {nameById.get(row.user_id) ?? 'Unknown'}
                    </span>
                    <span className="block text-xs text-fg-subtle">
                      {humanise(row.kind)}
                      {row.note ? ` · ${row.note}` : ''}
                    </span>
                  </td>
                  <td className="numeric px-4 py-3 text-fg-muted">
                    {row.starts_on} → {row.ends_on}
                    <span className="ml-2 text-xs text-fg-subtle">
                      {days(row.starts_on, row.ends_on)} day(s)
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin ? (
                      <DecideTimeOff id={row.id} />
                    ) : (
                      <StatusPill value="pending" tone="warning" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {decided.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-fg">Decided</h2>
          <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full text-sm">
              <tbody>
                {decided.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 text-fg">
                      {nameById.get(row.user_id) ?? 'Unknown'}
                      <span className="ml-2 text-xs text-fg-subtle">
                        {humanise(row.kind)}
                      </span>
                    </td>
                    <td className="numeric px-4 py-3 text-fg-muted">
                      {row.starts_on} → {row.ends_on}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StatusPill
                        value={row.status}
                        tone={row.status === 'approved' ? 'positive' : 'negative'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
