-- A roster for the people making the calls, whether or not they can log in.
--
-- 0060 built the name resolution and left the identity question open, because
-- it needed an answer only a person could give. The answer: the four call
-- centre agents need their calls attributed now, and Hub logins only if and
-- when somebody decides they should sign in. "Joshua Jung" was confirmed as the
-- Joshua already in the Hub.
--
-- So attribution is decoupled from login. A user_profiles row requires an
-- auth.users row and a unique email address, which makes it the wrong shape for
-- a contractor who will never sign in — and inventing email addresses to
-- satisfy a foreign key would mint login identities under addresses nobody
-- controls. call_agents is one row per real person doing call centre work, with
-- an OPTIONAL link to a profile for the ones who also have an account.
--
-- The result: every call attributes to a stable agent id. agent_user_id is
-- still filled for agents who have a profile, so everything already joining on
-- it keeps working, and Joshua's nine calls now reach his account.

create table call_agents (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,

  /*
   * Set only for an agent who also has a Hub account. Null is the normal case
   * here, not a defect: it means "this person makes calls and does not log in".
   * on delete set null rather than cascade — deactivating somebody's login must
   * never delete the record their calls hang off.
   */
  user_id      uuid references user_profiles (id) on delete set null,

  is_active    boolean not null default true,
  note         text,
  created_at   timestamptz not null default now()
);

comment on table call_agents is
  'One row per person doing call centre work. user_id links to a Hub profile '
  'only for those who also have an account; null means they make calls but do '
  'not sign in, which is the normal case for the call centre. Calls attribute '
  'to this table, so attribution never waits on an account being created.';

comment on column call_agents.user_id is
  'Optional. Fill it in when an agent gets a Hub login and their calls will '
  'start reaching their profile with no other change — resolve_call_summary_'
  'agents copies it onto call_summaries.agent_user_id.';

/*
 * One agent per name, enforced on the normalised form so "Karol Sanchez" and
 * "karol  sanchez" cannot both exist and make the exact-match resolution
 * ambiguous.
 */
create unique index call_agents_name_key
  on call_agents (normalise_person_name(display_name));

alter table call_agents enable row level security;

/*
 * Aliases now point at the roster rather than at a profile.
 *
 * 0060 pointed them at user_profiles, on the assumption that an agent worth
 * naming would have an account. That assumption is now retired. The table is
 * still empty, so this is a redefinition rather than a data migration.
 */
-- Dropping the column takes its foreign key with it, so the constraint is not
-- named here: a default name that turned out to differ would fail the migration
-- for no reason.
alter table call_agent_aliases drop column user_id;
alter table call_agent_aliases
  add column agent_id uuid not null references call_agents (id) on delete cascade;

comment on table call_agent_aliases is
  'Agent names as they appear on the call sheet, mapped to the roster entry '
  'they belong to. One row per spelling. Populated only from a confirmed '
  'answer — never from a guess, because a wrong row credits one person for '
  'another person''s calls.';

/*
 * The durable attribution. agent_user_id stays as it was and remains derived,
 * so nothing that already reads it has to change.
 */
alter table call_summaries
  add column if not exists agent_id uuid references call_agents (id) on delete set null;

comment on column call_summaries.agent_id is
  'The roster entry this call belongs to, resolved from agent_name. This is the '
  'attribution that always works; agent_user_id is filled from it only when the '
  'agent also has a Hub profile.';

create index if not exists call_summaries_agent_roster_idx
  on call_summaries (agent_id, called_on desc);

/*
 * Resolution, now in two steps: name to roster, then roster to profile.
 *
 * Fills nulls only, so a correction made by hand outlives the next import.
 */
create or replace function resolve_call_summary_agents()
returns integer
language plpgsql
as $fn$
declare
  by_alias   integer;
  by_name    integer;
  to_profile integer;
begin
  /*
   * Aliases first, because they are somebody's decision and must beat a name
   * that merely looks similar.
   */
  update call_summaries s
  set agent_id = a.agent_id
  from call_agent_aliases a
  where s.agent_id is null
    and normalise_person_name(s.agent_name) = a.alias;
  get diagnostics by_alias = row_count;

  /*
   * Then an exact match on the normalised roster name. NOT a fuzzy match:
   * crediting one agent with another's calls is worse than leaving a row
   * unattributed, and an unattributed row is visible in the scoreboard.
   *
   * No ambiguity guard is needed here — call_agents_name_key makes two roster
   * entries with the same normalised name impossible, which is a better place
   * to enforce it than a subquery on every update.
   */
  update call_summaries s
  set agent_id = g.id
  from call_agents g
  where s.agent_id is null
    and s.agent_name is not null
    and g.is_active
    and normalise_person_name(g.display_name) = normalise_person_name(s.agent_name);
  get diagnostics by_name = row_count;

  /*
   * Then carry the profile link down, for the agents who have one. This is why
   * granting an agent a login later needs no backfill script: fill in
   * call_agents.user_id, run this, and their history attributes to them.
   */
  update call_summaries s
  set agent_user_id = g.user_id
  from call_agents g
  where s.agent_user_id is null
    and s.agent_id = g.id
    and g.user_id is not null;
  get diagnostics to_profile = row_count;

  return by_alias + by_name + to_profile;
end;
$fn$;

comment on function resolve_call_summary_agents() is
  'Attaches call_summaries to the roster — confirmed aliases first, then an '
  'exact normalised name match — and then copies the roster''s profile link '
  'onto agent_user_id for agents who have an account. Fills nulls only, so a '
  'correction survives the next import. Returns rows touched.';

/*
 * The roster, from the five names the 215 imported summaries actually carry.
 *
 * Spelled exactly as the sheet spells them, which is what makes the exact-match
 * resolution find them without needing an alias each. A different spelling
 * later is what call_agent_aliases is for.
 */
insert into call_agents (display_name, note) values
  ('Karol Sanchez',     'From the imported call summaries: 128 calls, July 2026.'),
  ('Jennelyn Salazar',  'From the imported call summaries: 68 calls, July 2026.'),
  ('Maricris Cofreros', 'From the imported call summaries: 6 calls, July 2026.'),
  ('Susana Mariaca',    'From the imported call summaries: 4 calls, February 2026.')
on conflict do nothing;

/*
 * Joshua, whose profile already existed under a shorter name. Confirmed as the
 * same person before this row was written; the lookup is by email rather than
 * by a hardcoded id.
 */
insert into call_agents (display_name, user_id, note)
select
  'Joshua Jung',
  p.id,
  'Confirmed as the Joshua already in the Hub, whose profile is named '
  '"Joshua" and so never matched the sheet''s spelling. 9 calls, July 2026.'
from user_profiles p
where p.email = 'joshua@apexdentalmarketing.net'
on conflict do nothing;

/*
 * What is still unattributed, and why.
 *
 * Rewritten for the roster: the question is no longer "does a profile match"
 * but "is this person on the roster at all", because a missing roster entry is
 * the only thing that now blocks attribution.
 */
/*
 * Dropped and recreated rather than replaced: this view is renaming a column,
 * and CREATE OR REPLACE VIEW cannot rename one. Safe to drop — 0060 created it
 * minutes ago and nothing reads it yet.
 */
drop view if exists v_call_summary_agent_resolution;

create view v_call_summary_agent_resolution
with (security_invoker = on) as
  select
    s.agent_name,
    normalise_person_name(s.agent_name) as normalised,
    count(*)                            as summaries,
    min(s.called_on)                    as first_call,
    max(s.called_on)                    as last_call,
    exists (
      select 1 from call_agents g
      where normalise_person_name(g.display_name)
            = normalise_person_name(s.agent_name)
    )                                   as a_roster_entry_matches_this_spelling,
    exists (
      select 1 from call_agent_aliases a
      where a.alias = normalise_person_name(s.agent_name)
    )                                   as an_alias_covers_this_spelling
  from call_summaries s
  where s.agent_id is null
    and s.agent_name is not null
  group by s.agent_name;

comment on view v_call_summary_agent_resolution is
  'Call summaries that reached no roster entry, with the reason: whether a '
  'roster name matches the spelling and whether an alias covers it. Empty is '
  'the healthy state.';

/*
 * The scoreboard gains the roster columns. Appended rather than reordered,
 * because CREATE OR REPLACE VIEW cannot reorder and every existing reader
 * selects by name anyway.
 *
 * has_profile is the honest replacement for the "no profile" badge. A roster
 * agent without a Hub account is not a gap to be flagged — it is a contractor
 * doing their job. What deserves flagging is a call that reached no roster
 * entry at all, and that shows up as a null agent_id.
 */
create or replace view v_call_summary_agent_daily
with (security_invoker = on) as
  select
    s.agent_user_id,
    s.agent_name,
    s.called_on as day,
    count(*)                                            as calls,
    count(*) filter (where s.duration_seconds >= 120)   as calls_2min,
    count(*) filter (where coalesce(s.duration_seconds,0) = 0) as zero_length,
    sum(coalesce(s.duration_seconds, 0))                as talk_seconds,
    round(avg(nullif(s.duration_seconds, 0)))           as avg_talk_seconds,
    count(*) filter (where s.coaching is not null)      as calls_with_coaching,
    count(*) filter (where s.transcript is not null)    as calls_with_transcript,
    count(s.grading)                                    as calls_graded,
    round(avg(s.grading), 2)                            as avg_grading,
    count(*) filter (
      where lower(btrim(coalesce(s.process_followed, ''))) in ('yes', 'y', 'true')
    ) as process_followed_yes,
    count(s.process_followed)                           as process_answered,
    s.agent_id,
    coalesce(g.display_name, s.agent_name)              as agent_display_name,
    (g.user_id is not null)                             as has_profile
  from call_summaries s
  left join call_agents g on g.id = s.agent_id
  where s.called_on is not null
  group by s.agent_user_id, s.agent_name, s.called_on, s.agent_id,
           g.display_name, g.user_id;

comment on view v_call_summary_agent_daily is
  'Per agent per day from the AI call summaries: calls, calls past two minutes, '
  'zero-length calls, talk time, how many were transcribed or coached, and the '
  'audit''s own grading. Counts only — the transcript and coaching text are '
  'deliberately not carried into a view that feeds a leaderboard. avg_grading '
  'is over graded calls only, because an ungraded call is not a zero. '
  'process_followed_yes counts unambiguous yeses only. agent_id is the roster '
  'attribution and has_profile says whether that agent also has a Hub login — '
  'not having one is normal for the call centre, not a gap.';

select resolve_call_summary_agents();
