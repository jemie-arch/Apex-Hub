'use client';

/**
 * Per-agent call efficiency, and the AI transcript behind each call.
 *
 * This is the half of the call-centre page that GoHighLevel could never
 * supply. It stamps a user on 171 of 7,142 calls — 2.4% — because inbound
 * forwards off-platform, so the dial-based table above has always been empty
 * of people. The Make scenario that transcribes each recording writes a caller
 * name on every row, and that is what this reads.
 *
 * A client component because reading a call is an interaction: the summary is
 * what you scan and the transcript is what you open, and rendering forty full
 * transcripts expanded would put a megabyte of patient conversation on screen
 * to answer a question about volume.
 */
import { ChevronDown, MessageSquareText, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/ui/EmptyState';
import type { AgentCallStats, CallSummaryResult } from '@/lib/call-summaries';
import { cn } from '@/lib/cn';
import { formatCount, formatPercent } from '@/lib/format';

/** Seconds as m:ss, because a call is read in minutes and not in seconds. */
function clock(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '—';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function when(iso: string | null): string {
  if (iso === null) return 'undated';
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? 'undated'
    : at.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function AgentRow({ agent }: { agent: AgentCallStats }) {
  return (
    <tr className="border-b border-line last:border-0 hover:bg-surface-hover">
      <td className="px-4 py-3 font-medium text-fg">
        {agent.agentName ?? 'Unnamed'}
        {agent.agentId === null ? (
          /* Named on the call but matching no agent on the roster, so these
             calls belong to nobody and are missing from every per-person
             figure. This is the gap worth flagging, and it is fixed by adding
             the name to the roster or as an alias.

             Deliberately NOT flagged when the agent merely has no Hub login:
             most of the call centre are contractors who never sign in, and
             badging them all as a problem trained everybody to ignore the
             badge. */
          <span className="ml-2 rounded bg-warning-subtle px-1.5 py-0.5 text-[10px] font-normal text-warning">
            not on the roster
          </span>
        ) : null}
      </td>
      <td className="numeric px-4 py-3 text-right">{formatCount(agent.calls)}</td>
      <td className="numeric px-4 py-3 text-right">{formatCount(agent.calls2min)}</td>
      <td className="numeric px-4 py-3 text-right">
        {formatPercent(agent.conversationRate, 1)}
      </td>
      <td className="numeric px-4 py-3 text-right">{clock(agent.avgTalkSeconds)}</td>
      <td className="numeric px-4 py-3 text-right text-fg-subtle">
        {formatCount(agent.withCoaching)}
      </td>
    </tr>
  );
}

export function CallSummaries({ data }: { data: CallSummaryResult }) {
  const [openCall, setOpenCall] = useState<string | null>(null);

  if (data.imported === 0) {
    /*
     * An explanation rather than an empty state, because there is exactly one
     * cause and it is actionable. The scenario ran on 28 August, filled Make's
     * organisation dead-letter queue, and was switched off. Saying "no calls"
     * would read as a quiet fortnight.
     */
    return (
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fg">Call efficiency by agent</h2>
        <div className="mt-3 flex gap-3 rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          <div className="text-xs leading-relaxed text-fg-muted">
            <p className="font-medium text-fg">
              Nothing imported yet — and this is not a quiet period.
            </p>
            <p className="mt-1">
              The transcription is already built: Make scenario 5560467
              transcribes each recording, labels the speakers, summarises the
              call and writes sales coaching from a graded audit. It ran on 28
              August 2026, filled Make&apos;s organisation dead-letter queue
              (500&nbsp;MB), and was switched off.
            </p>
            <p className="mt-1.5">
              Clear that queue and re-enable the scenario, and this page fills
              from the next call — including the per-agent figures GoHighLevel
              cannot provide, because it names a user on 2.4% of calls and this
              names one on every row.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-fg">
            Call efficiency by agent
          </h2>
          <p className="mt-0.5 text-xs text-fg-subtle">
            From the AI call summaries — the only source that names who made
            each call.
          </p>
        </div>
        {data.unattached > 0 ? (
          <span className="text-[11px] text-warning">
            {formatCount(data.unattached)} call(s) match no Hub profile
          </span>
        ) : null}
      </div>

      {data.agents.length === 0 ? (
        <EmptyState
          title="No calls in this period"
          description="The dates are present, so this one is a real zero."
          icon={<MessageSquareText size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 text-right font-medium">Calls</th>
                  <th className="px-4 py-3 text-right font-medium">Past 2 min</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Conversation %
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Avg talk</th>
                  <th className="px-4 py-3 text-right font-medium">Coached</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((agent) => (
                  <AgentRow
                    key={agent.agentUserId ?? agent.agentName ?? 'unknown'}
                    agent={agent}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-fg-subtle">
            Conversation % is calls past two minutes over calls, computed from
            the totals rather than averaged across days. Average talk time
            ignores zero-length calls — counting them in reports a shorter
            conversation than anybody had.
          </p>
        </div>
      )}

      {data.recent.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold text-fg">Recent calls</h3>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Summary and coaching are AI-generated from the recording. Open a
            call to read the transcript.
          </p>

          <ul className="mt-3 space-y-2">
            {data.recent.map((call) => {
              const open = openCall === call.id;
              return (
                <li
                  key={call.id}
                  className="panel overflow-hidden rounded-lg border border-line bg-surface"
                >
                  <button
                    type="button"
                    onClick={() => setOpenCall(open ? null : call.id)}
                    aria-expanded={open}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-hover"
                  >
                    <ChevronDown
                      size={15}
                      aria-hidden
                      className={cn(
                        'mt-0.5 shrink-0 text-fg-subtle transition-transform',
                        open && 'rotate-180',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-medium text-fg">
                          {call.agentName ?? 'Unnamed agent'}
                        </span>
                        <span className="text-xs text-fg-muted">
                          {call.leadName ?? 'unknown lead'}
                        </span>
                        <span className="numeric text-[11px] text-fg-subtle">
                          {when(call.calledAt)} · {clock(call.durationSeconds)}
                        </span>
                      </span>
                      {call.summary ? (
                        <span className="mt-1 block whitespace-pre-line text-xs leading-relaxed text-fg-muted">
                          {open ? call.summary : call.summary.slice(0, 180)}
                          {!open && call.summary.length > 180 ? '…' : ''}
                        </span>
                      ) : (
                        <span className="mt-1 block text-xs text-fg-subtle">
                          No summary — the transcript may still be there.
                        </span>
                      )}
                    </span>
                  </button>

                  {open ? (
                    <div className="border-t border-line px-4 py-3">
                      {call.coaching ? (
                        <div className="mb-3">
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent">
                            Coaching
                          </p>
                          <p className="whitespace-pre-line text-xs leading-relaxed text-fg-muted">
                            {call.coaching}
                          </p>
                        </div>
                      ) : null}

                      {call.transcript ? (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                            Transcript
                          </p>
                          {/* Scrolls inside its own box. A long consultation
                              runs to thousands of lines and must not push the
                              page. */}
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-line bg-surface-sunken p-3 text-[11px] leading-relaxed text-fg-muted">
                            {call.transcript}
                          </pre>
                        </div>
                      ) : (
                        <p className="text-xs text-fg-subtle">
                          No transcript stored for this call.
                        </p>
                      )}

                      {call.recordingUrl ? (
                        <p className="mt-2 text-[11px] text-fg-subtle">
                          {/* Deliberately not an <a download> and not an audio
                              player: the URL is GoHighLevel's and may expire,
                              so it is shown as the reference it is. */}
                          Recording: {call.recordingUrl}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
