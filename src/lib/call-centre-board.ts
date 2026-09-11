/**
 * The team board the call centre reads off HotProspector, computed from our own
 * per-call feed.
 *
 * Joshua asked for these stats updated daily. Nothing here is scraped: every
 * figure comes from raw_call_rows, the same feed the pay dashboard counts, so
 * this board and what agents are paid cannot drift apart. A scrape would
 * guarantee they eventually did.
 *
 * WHAT IS CONFIRMED AND WHAT IS NOT
 *
 * Three rates were reconciled exactly against a live HotProspector board:
 * AR is of outbound, CR is of answers, ABR is of conversations. Those
 * denominators are settled.
 *
 * "Answers" is not. It is a HotProspector concept and nothing in our feed
 * reproduces its figure — five candidate definitions span 19% to 96% against a
 * board showing 45%. So the columns downstream of it (ANSWERS, AR, CR) are
 * deliberately absent rather than filled with the closest guess, and the view
 * carries all five candidates so one same-day comparison settles it.
 *
 * ANS/HR, SMS and PROSPECTS need sources the call feed does not carry. They are
 * named as unavailable rather than dropped, because a board that looks complete
 * and is not is worse than one that admits a gap.
 *
 * EVERY RATE IS COMPUTED FROM SUMMED COUNTERS, never averaged across days — a
 * day with 5 calls and a day with 500 do not contribute equally to a rate, and
 * a mean of two rates pretends they do.
 */
import { serviceClient } from '@/lib/supabase/service';

export interface CallCentreRow {
  agentId: string;
  displayName: string;
  outbound: number;
  inbound: number;
  hangUps: number;
  convos: number;
  appts: number;
  talkSeconds: number;
  /** Average outbound duration, seconds. Null when nothing connected. */
  aodSeconds: number | null;
  /** Average inbound duration, seconds. Null when nothing connected. */
  aidSeconds: number | null;
  /** Average across all timed calls, seconds. */
  avgSeconds: number | null;
  /** Appointments over conversations. Null rather than zero on no conversations. */
  abr: number | null;
}

export interface CallCentreBoard {
  agents: CallCentreRow[];
  team: CallCentreRow | null;
  /** The most recent day the feed holds, so the page can say how fresh it is. */
  latestDay: string | null;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

export async function getCallCentreBoard(range: {
  from: string;
  to: string;
}): Promise<CallCentreBoard> {
  const db = serviceClient();

  const daily = await db
    .from('v_call_centre_agent_daily')
    .select(
      'agent_id, display_name, day, outbound, inbound, hang_ups, convos, appts, talk_seconds, outbound_seconds, outbound_timed, inbound_seconds, inbound_timed',
    )
    .gte('day', range.from)
    .lte('day', range.to);

  if (daily.error) throw daily.error;

  interface Accumulator {
    agentId: string;
    displayName: string;
    outbound: number;
    inbound: number;
    hangUps: number;
    convos: number;
    appts: number;
    talkSeconds: number;
    outboundSeconds: number;
    outboundTimed: number;
    inboundSeconds: number;
    inboundTimed: number;
  }

  const byAgent = new Map<string, Accumulator>();
  let latestDay: string | null = null;

  for (const row of daily.data ?? []) {
    const key = row.agent_id ?? row.display_name ?? 'unknown';
    if (row.day && (latestDay === null || row.day > latestDay)) latestDay = row.day;

    const held =
      byAgent.get(key) ??
      ({
        agentId: row.agent_id ?? '',
        displayName: row.display_name ?? 'Unnamed',
        outbound: 0,
        inbound: 0,
        hangUps: 0,
        convos: 0,
        appts: 0,
        talkSeconds: 0,
        outboundSeconds: 0,
        outboundTimed: 0,
        inboundSeconds: 0,
        inboundTimed: 0,
      } satisfies Accumulator);

    held.outbound += Number(row.outbound ?? 0);
    held.inbound += Number(row.inbound ?? 0);
    held.hangUps += Number(row.hang_ups ?? 0);
    held.convos += Number(row.convos ?? 0);
    held.appts += Number(row.appts ?? 0);
    held.talkSeconds += Number(row.talk_seconds ?? 0);
    held.outboundSeconds += Number(row.outbound_seconds ?? 0);
    held.outboundTimed += Number(row.outbound_timed ?? 0);
    held.inboundSeconds += Number(row.inbound_seconds ?? 0);
    held.inboundTimed += Number(row.inbound_timed ?? 0);

    byAgent.set(key, held);
  }

  const finish = (a: Accumulator): CallCentreRow => ({
    agentId: a.agentId,
    displayName: a.displayName,
    outbound: a.outbound,
    inbound: a.inbound,
    hangUps: a.hangUps,
    convos: a.convos,
    appts: a.appts,
    talkSeconds: a.talkSeconds,
    aodSeconds: ratio(a.outboundSeconds, a.outboundTimed),
    aidSeconds: ratio(a.inboundSeconds, a.inboundTimed),
    avgSeconds: ratio(
      a.outboundSeconds + a.inboundSeconds,
      a.outboundTimed + a.inboundTimed,
    ),
    abr: ratio(a.appts, a.convos),
  });

  const agents = [...byAgent.values()]
    /*
     * Anybody with no activity in the window is dropped rather than listed at
     * zero. The roster holds everyone who has ever made a call, including
     * people who have left, and a board padded with dormant names is harder to
     * read than a short one.
     */
    .filter((a) => a.outbound + a.inbound > 0)
    .map(finish)
    .sort((a, b) => b.outbound - a.outbound);

  /*
   * The team row is summed from the same counters rather than averaged from the
   * agent rows, so its rates are the true blended figures.
   */
  const team =
    agents.length === 0
      ? null
      : finish(
          [...byAgent.values()]
            .filter((a) => a.outbound + a.inbound > 0)
            .reduce<Accumulator>(
              (sum, a) => ({
                agentId: 'team',
                displayName: 'Team',
                outbound: sum.outbound + a.outbound,
                inbound: sum.inbound + a.inbound,
                hangUps: sum.hangUps + a.hangUps,
                convos: sum.convos + a.convos,
                appts: sum.appts + a.appts,
                talkSeconds: sum.talkSeconds + a.talkSeconds,
                outboundSeconds: sum.outboundSeconds + a.outboundSeconds,
                outboundTimed: sum.outboundTimed + a.outboundTimed,
                inboundSeconds: sum.inboundSeconds + a.inboundSeconds,
                inboundTimed: sum.inboundTimed + a.inboundTimed,
              }),
              {
                agentId: 'team',
                displayName: 'Team',
                outbound: 0,
                inbound: 0,
                hangUps: 0,
                convos: 0,
                appts: 0,
                talkSeconds: 0,
                outboundSeconds: 0,
                outboundTimed: 0,
                inboundSeconds: 0,
                inboundTimed: 0,
              },
            ),
        );

  return { agents, team, latestDay };
}
