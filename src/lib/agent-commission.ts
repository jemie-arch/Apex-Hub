/**
 * Agent commission, as the pay dashboard calculates it.
 *
 * Reads v_agent_commission, which reproduces cells J2 and O2 of the STATS
 * DASHBOARD tab: count RAW DATA rows where the agent matches and the
 * disposition contains "Booked" inside the selected window, then apply a flat
 * rate to all of them, chosen by which threshold the count falls under.
 *
 * It reproduces the sheet rather than improving on it, deliberately. The rate
 * is a cliff, not a marginal tier — an agent on 95 bookings earns 95 x $8 and
 * one on 96 earns 96 x $10, so the 96th booking is worth $200. That is what
 * people are actually paid, and a fairer calculation here would only add a
 * third number to the argument.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The Hub and the dashboard disagreed on booking counts in opposite directions
 * for weeks, which ruled out every single-cause explanation anyone proposed.
 * The dashboard counts the RAW DATA tab; the Hub was counting the BOOKING SHEET
 * tab. They were answering different questions about different sheets.
 */
import { serviceClient } from '@/lib/supabase/service';

export interface AgentCommission {
  agentId: string;
  displayName: string;
  /** Null for the call centre, who are on the roster but have no Hub login. */
  userId: string | null;
  calls30d: number;
  bookedToday: number;
  bookedYesterday: number;
  booked3d: number;
  booked7d: number;
  booked30d: number;
  band: 'base' | 'quota1' | 'quota2';
  rateCents: number;
  commissionCents: number;
  /** Null once the top band is reached — there is nothing further to climb to. */
  bookingsToNextBand: number | null;
}

export async function getAgentCommission(): Promise<AgentCommission[]> {
  const db = serviceClient();

  const result = await db
    .from('v_agent_commission')
    .select(
      'agent_id, display_name, user_id, calls_30d, booked_today, booked_yesterday, booked_3d, booked_7d, booked_30d, band, rate_cents, commission_cents, bookings_to_next_band',
    );

  if (result.error) throw result.error;

  return (result.data ?? [])
    .map((row) => ({
      agentId: row.agent_id ?? '',
      displayName: row.display_name ?? 'Unnamed',
      userId: row.user_id,
      calls30d: Number(row.calls_30d ?? 0),
      bookedToday: Number(row.booked_today ?? 0),
      bookedYesterday: Number(row.booked_yesterday ?? 0),
      booked3d: Number(row.booked_3d ?? 0),
      booked7d: Number(row.booked_7d ?? 0),
      booked30d: Number(row.booked_30d ?? 0),
      band: (row.band ?? 'base') as AgentCommission['band'],
      rateCents: Number(row.rate_cents ?? 0),
      commissionCents: Number(row.commission_cents ?? 0),
      bookingsToNextBand:
        row.bookings_to_next_band === null
          ? null
          : Number(row.bookings_to_next_band),
    }))
    /*
     * Anybody with no activity in the window is dropped rather than listed at
     * zero. The roster deliberately holds everyone who has ever made a call,
     * including people who have left, and a pay table padded with dormant names
     * is harder to read than a short one.
     */
    .filter((agent) => agent.calls30d > 0 || agent.booked30d > 0)
    .sort((a, b) => b.booked30d - a.booked30d);
}
