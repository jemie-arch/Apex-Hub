/**
 * The call-summary reads for the call-centre page.
 *
 * Two questions, deliberately answered by two queries rather than one.
 *
 * The scoreboard needs counts per agent, and nothing else — so it reads the
 * aggregate view and never touches the transcript text. A leaderboard that
 * selects a column holding whole patient conversations pulls megabytes into
 * every page render for numbers that fit on one line.
 *
 * The call list needs the text, but only for the calls actually on screen, so
 * it is bounded and paged rather than fetched with the totals.
 */
import { serviceClient } from '@/lib/supabase/service';

export interface AgentCallStats {
  agentUserId: string | null;
  agentName: string | null;
  calls: number;
  calls2min: number;
  zeroLength: number;
  talkSeconds: number;
  /** Ignores zero-length calls — see the view's comment. */
  avgTalkSeconds: number | null;
  withTranscript: number;
  withCoaching: number;
  /** calls2min / calls, computed from the summed counts and never averaged. */
  conversationRate: number | null;
}

export interface CallSummaryRow {
  id: string;
  calledAt: string | null;
  agentName: string | null;
  leadName: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  summary: string | null;
  coaching: string | null;
  transcript: string | null;
}

export interface CallSummaryResult {
  agents: AgentCallStats[];
  recent: CallSummaryRow[];
  /** Total rows imported, so an empty scoreboard can say which kind of empty. */
  imported: number;
  unattached: number;
}

const RECENT_LIMIT = 40;

export async function getCallSummaries(range: {
  from: string;
  to: string;
}): Promise<CallSummaryResult> {
  const db = serviceClient();

  const [daily, recent, total, orphaned] = await Promise.all([
    db
      .from('v_call_summary_agent_daily')
      .select(
        'agent_user_id, agent_name, day, calls, calls_2min, zero_length, talk_seconds, avg_talk_seconds, calls_with_transcript, calls_with_coaching',
      )
      .gte('day', range.from)
      .lte('day', range.to),
    /*
     * The transcript is selected here and only here, for at most forty rows.
     * Ordered newest first because the reason somebody opens this page is to
     * read the call that just happened.
     */
    db
      .from('call_summaries')
      .select(
        'id, called_at, agent_name, lead_name, duration_seconds, recording_url, summary, coaching, transcript',
      )
      .gte('called_on', range.from)
      .lte('called_on', range.to)
      .order('called_at', { ascending: false, nullsFirst: false })
      .limit(RECENT_LIMIT),
    db.from('call_summaries').select('id', { count: 'exact', head: true }),
    db
      .from('call_summaries')
      .select('id', { count: 'exact', head: true })
      .is('agent_user_id', null),
  ]);

  if (daily.error) throw daily.error;
  if (recent.error) throw recent.error;

  /*
   * Summed across days, then divided once.
   *
   * The view is per day, so a rate has to come from the totals rather than
   * from averaging each day's rate — the same rule every other figure in this
   * codebase follows, and wrong here in exactly the direction that flatters a
   * quiet day.
   */
  const byAgent = new Map<string, AgentCallStats>();

  for (const row of daily.data ?? []) {
    const key = row.agent_user_id ?? `name:${row.agent_name ?? 'unknown'}`;
    const held =
      byAgent.get(key) ??
      ({
        agentUserId: row.agent_user_id,
        agentName: row.agent_name,
        calls: 0,
        calls2min: 0,
        zeroLength: 0,
        talkSeconds: 0,
        avgTalkSeconds: null,
        withTranscript: 0,
        withCoaching: 0,
        conversationRate: null,
      } satisfies AgentCallStats);

    held.calls += row.calls ?? 0;
    held.calls2min += row.calls_2min ?? 0;
    held.zeroLength += row.zero_length ?? 0;
    held.talkSeconds += row.talk_seconds ?? 0;
    held.withTranscript += row.calls_with_transcript ?? 0;
    held.withCoaching += row.calls_with_coaching ?? 0;
    byAgent.set(key, held);
  }

  for (const held of byAgent.values()) {
    const answered = held.calls - held.zeroLength;
    held.avgTalkSeconds =
      answered > 0 ? Math.round(held.talkSeconds / answered) : null;
    held.conversationRate = held.calls > 0 ? held.calls2min / held.calls : null;
  }

  return {
    agents: [...byAgent.values()].sort((a, b) => b.calls - a.calls),
    recent: (recent.data ?? []).map((row) => ({
      id: row.id,
      calledAt: row.called_at,
      agentName: row.agent_name,
      leadName: row.lead_name,
      durationSeconds: row.duration_seconds,
      recordingUrl: row.recording_url,
      summary: row.summary,
      coaching: row.coaching,
      transcript: row.transcript,
    })),
    imported: total.count ?? 0,
    unattached: orphaned.count ?? 0,
  };
}
