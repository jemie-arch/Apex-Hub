/**
 * Call-centre performance, per person.
 *
 * The two roles are measured differently and must not be averaged together:
 *   ISR  outbound volume and what it produced — dials, connects, appointments
 *   CSR  how calls were handled — talk time and the AI audit score
 *
 * Unscored calls are counted separately rather than treated as zero. A rep
 * whose calls were never audited is not a rep who scored nothing, and folding
 * the two together is how a leaderboard starts lying.
 */
import type { UserRole } from '@/types/database';

import { bounds, type DateRange } from '@/lib/range';
import { serviceClient } from '@/lib/supabase/service';

export interface RepStats {
  userId: string;
  name: string;
  email: string;
  role: UserRole;

  dials: number;
  connects: number;
  connectRate: number | null;
  talkSeconds: number;
  avgTalkSeconds: number | null;

  /** Appointments this person booked, and how many turned up. */
  bookingsSet: number;
  bookingsShowed: number;
  showRate: number | null;

  scoredCalls: number;
  unscoredCalls: number;
  avgQuality: number | null;
}

const CONNECTED_OUTCOMES = new Set(['connected', 'booked']);

/**
 * The two call-centre views, and every role that belongs in each.
 *
 * 'isr' and 'csr' are the view names as well as the original role names, which
 * is why this map exists rather than a comparison: isa and csm are the current
 * names for the same jobs, and filtering on the old pair alone made every
 * newly hired caller invisible on the call-centre page.
 */
const ROLES_IN_VIEW = {
  isr: ['isr', 'isa'],
  csr: ['csr', 'csm'],
} as const;

export async function getRepStats(
  range: DateRange,
  role?: 'isr' | 'csr',
): Promise<RepStats[]> {
  const db = serviceClient();
  const { start, end } = bounds(range.from, range.to);

  const profileQuery = db
    .from('user_profiles')
    .select('id, full_name, email, role')
    .in(
      'role',
      role ? [...ROLES_IN_VIEW[role]] : [...ROLES_IN_VIEW.isr, ...ROLES_IN_VIEW.csr],
    )
    .eq('is_active', true)
    .order('full_name');

  const [profiles, calls, appointments] = await Promise.all([
    profileQuery,
    db
      .from('calls')
      .select('user_id, outcome, duration_seconds, quality_score')
      .gte('started_at', start)
      .lte('started_at', end),
    db
      .from('appointments')
      .select('booked_by_user_id, showed')
      .gte('scheduled_at', start)
      .lte('scheduled_at', end)
      .not('booked_by_user_id', 'is', null),
  ]);

  if (profiles.error) throw profiles.error;
  if (calls.error) throw calls.error;
  if (appointments.error) throw appointments.error;

  const stats = new Map<string, RepStats>();
  for (const profile of profiles.data ?? []) {
    stats.set(profile.id, {
      userId: profile.id,
      name: profile.full_name ?? profile.email,
      email: profile.email,
      role: profile.role,
      dials: 0,
      connects: 0,
      connectRate: null,
      talkSeconds: 0,
      avgTalkSeconds: null,
      bookingsSet: 0,
      bookingsShowed: 0,
      showRate: null,
      scoredCalls: 0,
      unscoredCalls: 0,
      avgQuality: null,
    });
  }

  const qualityTotals = new Map<string, number>();

  for (const call of calls.data ?? []) {
    if (!call.user_id) continue;
    const entry = stats.get(call.user_id);
    // A call belonging to someone outside the requested role is skipped, not
    // attributed to a guess.
    if (!entry) continue;

    entry.dials += 1;
    if (call.outcome && CONNECTED_OUTCOMES.has(call.outcome)) entry.connects += 1;
    entry.talkSeconds += call.duration_seconds;

    if (call.quality_score === null) {
      entry.unscoredCalls += 1;
    } else {
      entry.scoredCalls += 1;
      qualityTotals.set(
        call.user_id,
        (qualityTotals.get(call.user_id) ?? 0) + call.quality_score,
      );
    }
  }

  for (const appointment of appointments.data ?? []) {
    if (!appointment.booked_by_user_id) continue;
    const entry = stats.get(appointment.booked_by_user_id);
    if (!entry) continue;

    entry.bookingsSet += 1;
    if (appointment.showed === true) entry.bookingsShowed += 1;
  }

  for (const entry of stats.values()) {
    entry.connectRate = entry.dials === 0 ? null : entry.connects / entry.dials;
    entry.avgTalkSeconds =
      entry.connects === 0 ? null : Math.round(entry.talkSeconds / entry.connects);
    entry.showRate =
      entry.bookingsSet === 0 ? null : entry.bookingsShowed / entry.bookingsSet;
    entry.avgQuality =
      entry.scoredCalls === 0
        ? null
        : (qualityTotals.get(entry.userId) ?? 0) / entry.scoredCalls;
  }

  return [...stats.values()].sort((a, b) => {
    // ISRs rank by what they produced, CSRs by how they handled calls.
    const bothCsr =
      (a.role === 'csr' || a.role === 'csm') &&
      (b.role === 'csr' || b.role === 'csm');
    if (bothCsr) {
      return (b.avgQuality ?? -1) - (a.avgQuality ?? -1);
    }
    return b.bookingsSet - a.bookingsSet || b.dials - a.dials;
  });
}

export async function getRepStat(
  range: DateRange,
  userId: string,
): Promise<RepStats | null> {
  const all = await getRepStats(range);
  return all.find((entry) => entry.userId === userId) ?? null;
}
