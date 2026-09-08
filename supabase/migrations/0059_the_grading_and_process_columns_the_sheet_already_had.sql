-- The grading and SOP columns the summary sheet already had.
--
-- The first import of the AI call summaries worked — 215 calls, every one with
-- a transcript and a summary — and its unrecognised-headers report named five
-- columns the config had not mapped. Three of them matter:
--
--   "Call Sales Audit"        the coaching. 0 of 215 had landed.
--   "Grading (1-10)"          the audit's own score for the call.
--   "Call Process Followed?"  whether the agent followed the SOP.
--
-- The last two nobody had mentioned. They are the AI sales coach scoring
-- itself, and per agent they are worth more than any counter this import was
-- built around: a 1-10 score and an SOP-compliance rate say more about how
-- somebody is doing than "calls past two minutes" ever will.
--
-- This is the discovery-first reporting paying for itself. The columns existed
-- for months and nothing read them, because nobody knew to ask.

alter table call_summaries
  add column if not exists grading numeric,
  add column if not exists process_followed text;

comment on column call_summaries.grading is
  'The sheet''s "Grading (1-10)" column — the AI sales audit''s own score for '
  'the call. Discovered from the first import''s unrecognised-headers report; '
  'nobody had said it existed. Stored as numeric rather than integer because '
  'the column is written by a language model and has been seen to produce '
  '7.5 as readily as 7.';

comment on column call_summaries.process_followed is
  'The sheet''s "Call Process Followed?" column — whether the agent followed '
  'the SOP, as judged by the audit. Kept as TEXT, not boolean: it is a model''s '
  'answer to a question, and "Partially" is a real answer that a boolean would '
  'have to round to yes or no. v_call_summary_agent_daily counts only the '
  'unambiguous yeses.';

create or replace view v_call_summary_agent_daily
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
    count(*) filter (where transcript is not null)      as calls_with_transcript,
    /*
     * Graded calls counted separately from the average, because an ungraded
     * call is not a zero-scored one — and averaging over calls the audit never
     * reached would drag every agent's score toward nothing.
     */
    count(grading)                                      as calls_graded,
    round(avg(grading), 2)                              as avg_grading,
    /*
     * Only the unambiguous yeses. "Partially" and anything else the model
     * wrote are counted as not-followed rather than guessed at, which is the
     * conservative direction for a compliance figure.
     */
    count(*) filter (
      where lower(btrim(coalesce(process_followed, ''))) in ('yes', 'y', 'true')
    ) as process_followed_yes,
    count(process_followed)                             as process_answered
  from call_summaries
  where called_on is not null
  group by agent_user_id, agent_name, called_on;

comment on view v_call_summary_agent_daily is
  'Per agent per day from the AI call summaries: calls, calls past two '
  'minutes, zero-length calls, talk time, how many were transcribed or coached, '
  'and the audit''s own grading. Counts only — the transcript and coaching text '
  'are deliberately not carried into a view that feeds a leaderboard. '
  'avg_grading is over graded calls only, because an ungraded call is not a '
  'zero. process_followed_yes counts unambiguous yeses only; anything else the '
  'model wrote is treated as not followed, which is the conservative direction '
  'for a compliance number.';
