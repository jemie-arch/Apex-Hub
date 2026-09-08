-- The AI call summaries Make already writes, and nothing has ever read.
--
-- WHAT EXISTS ALREADY
--
-- Make scenario 5560467, "Call Center Dashboard HP->SheetsAI->Transcript",
-- does the whole job the Hub was said to be missing:
--
--   webhook -> download the recording -> AssemblyAI transcription
--   -> GPT labels the speakers (Agent: / Lead:)
--   -> GPT summarises the call into bullet points
--   -> GPT grades it as a sales audit and writes coaching from the grading
--   -> Google Sheets + Slack
--
-- It ran on 28 August 2026 and worked — dozens of executions, several doing
-- the full transcription path. It then hit Make's organisation dead-letter
-- queue limit ("NOT ENOUGH SPACE to add a new incomplete execution ...
-- Organization DLQ size limit: 500MB") and was switched off.
--
-- So the transcription, the summary and the sales coach are all built. What was
-- missing is that nothing read the sheet they land in.
--
-- Worth recording plainly: it was previously reported that this could not be
-- built because recording_url is null on all 7,142 rows of `calls`, so the Hub
-- held no audio. That was true and beside the point. Make fetches the audio
-- from GoHighLevel itself; the Hub never needed it.
--
-- THE AGENT'S NAME IS IN HERE
--
-- caller_name, column B, on every row. That is the attribution GoHighLevel
-- cannot give: it stamps a user on 171 of 7,142 calls, 2.4%, because inbound
-- forwards off-platform. Per-agent call efficiency was blocked on exactly this
-- field, and it has been sitting in a spreadsheet.

create table call_summaries (
  id              uuid primary key default gen_random_uuid(),

  -- The sheet's own row number, and the upsert key. Same identity discipline
  -- as every other sheet import here.
  source_row      integer not null unique,

  -- When the call happened, as the sheet records it.
  called_at       timestamptz,
  called_on       date,

  /*
   * Column B, and the reason this table matters beyond the transcript.
   * Free text typed by whatever wrote the row, so it is matched to a Hub
   * profile by name rather than trusted as an id.
   */
  agent_name      text,
  agent_user_id   uuid references user_profiles (id) on delete set null,

  lead_name       text,
  /* GoHighLevel's contact id, which is what joins a call to a lead. */
  lead_crm_id     text,
  to_number       text,

  duration_seconds integer,
  recording_url    text,

  /*
   * The three AI outputs, kept apart because they answer different questions
   * and are produced by different prompts.
   *
   *   transcript  speaker-labelled, "Agent:" / "Lead:"
   *   summary     bullet points — what the lead wanted, what was agreed
   *   coaching    written from a sales-audit grading of the call
   *
   * Stored as text and never parsed. A summary is somebody's words about a
   * patient conversation; the Hub's job is to show it, not to mine it.
   */
  transcript      text,
  summary         text,
  coaching        text,

  imported_at     timestamptz not null default now()
);

create index call_summaries_day_idx on call_summaries (called_on desc);
create index call_summaries_agent_idx on call_summaries (agent_user_id, called_on desc);
create index call_summaries_lead_idx on call_summaries (lead_crm_id)
  where lead_crm_id is not null;

alter table call_summaries enable row level security;

/*
 * Staff only, and no client access at all.
 *
 * These rows carry a patient conversation in full. Every other patient-bearing
 * table here is scoped to a practice so the practice can see its own; this one
 * is not, deliberately — a transcript is a recording of a person speaking, and
 * a coaching note is an assessment of an employee. Neither belongs in a client
 * portal, and the portal is unauthenticated by token.
 */
create policy call_summaries_staff_read on call_summaries
  for select
  using (auth_role() is not null and auth_role() <> 'client');

comment on table call_summaries is
  'AI call transcription, summary and sales coaching, imported from the Google '
  'Sheet that Make scenario 5560467 writes. That scenario already does the '
  'transcription (AssemblyAI), the speaker labelling, the summary and the '
  'coaching; this table is the Hub reading its output. '
  'agent_name is the field per-agent call attribution was blocked on — '
  'GoHighLevel names a user on 2.4% of calls, this names one on every row. '
  'Staff-only by policy: a transcript is a patient speaking and the coaching is '
  'an assessment of an employee, so neither goes near the client portal.';

comment on column call_summaries.agent_user_id is
  'Resolved from agent_name against user_profiles, never taken from the sheet. '
  'Null means the name matched no profile — see v_call_summary_unmatched_agents, '
  'which is the queue that decides whether per-agent figures are complete.';

/*
 * Per agent per day, for the call-efficiency scoreboard.
 *
 * Counts and averages only. The transcript, summary and coaching are
 * deliberately absent: this view feeds a leaderboard, and a leaderboard has no
 * business carrying the contents of a patient conversation into every query
 * that reads it.
 */
create view v_call_summary_agent_daily
with (security_invoker = on) as
  select
    agent_user_id,
    agent_name,
    called_on as day,
    count(*)                                            as calls,
    count(*) filter (where duration_seconds >= 120)     as calls_2min,
    count(*) filter (where coalesce(duration_seconds,0) = 0) as zero_length,
    sum(coalesce(duration_seconds, 0))                  as talk_seconds,
    round(avg(nullif(duration_seconds, 0)))             as avg_talk_seconds,
    count(*) filter (where coaching is not null)        as calls_with_coaching,
    count(*) filter (where transcript is not null)      as calls_with_transcript
  from call_summaries
  where called_on is not null
  group by agent_user_id, agent_name, called_on;

comment on view v_call_summary_agent_daily is
  'Per agent per day from the AI call summaries: calls, calls past two '
  'minutes, zero-length calls, talk time and how many were transcribed or '
  'coached. Counts only — the transcript and coaching text are deliberately '
  'not carried into a view that feeds a leaderboard. avg_talk_seconds ignores '
  'zero-length calls, because averaging them in reports a shorter '
  'conversation than anybody had.';

-- The queue for names that matched no profile, mirroring the tracker's
-- unmatched-practice view. Every row here is a call missing from a person's
-- figures.
create view v_call_summary_unmatched_agents
with (security_invoker = on) as
select
  agent_name,
  count(*)              as calls,
  min(called_on)        as earliest,
  max(called_on)        as latest
from call_summaries
where agent_user_id is null
  and agent_name is not null
group by agent_name
order by count(*) desc;

comment on view v_call_summary_unmatched_agents is
  'Call summaries whose caller_name matched no Hub profile. Each one is a call '
  'absent from that person''s per-agent figures, so this is the queue that '
  'decides whether the call scoreboard is complete. Fix by correcting the name '
  'in user_profiles.full_name or by adding the spelling the sheet uses.';
