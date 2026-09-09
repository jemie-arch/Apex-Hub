-- Attach call summaries to the person who made the call.
--
-- All 215 imported summaries carry an agent name and none carries an
-- agent_user_id, so every row in the call-efficiency scoreboard is badged "no
-- profile" and nothing that groups by person sees the call centre at all.
--
-- There are two reasons for that, and only one of them is "the profile does
-- not exist":
--
--   Karol Sanchez      128 calls   no profile
--   Jennelyn Salazar    68 calls   no profile
--   Joshua Jung          9 calls   PROFILE EXISTS, named "Joshua"
--   Maricris Cofreros    6 calls   no profile
--   Susana Mariaca       4 calls   no profile
--
-- "Joshua Jung" is the case that shows why creating profiles is not on its own
-- a fix. A profile for that person is already here; it just spells the name
-- differently, and an equality test on full_name will never join the two. Any
-- profile created for the other four will hit the same wall the moment the
-- sheet spells a name with a middle initial, a married name or a swapped
-- given/family order — which a sheet filled in by hand eventually does.
--
-- So this migration builds the resolution step. Creating the four missing
-- profiles is a separate decision, because a user_profiles row requires an
-- auth.users row and a unique email address, and inventing email addresses for
-- real people would mint login identities nobody asked for.

/*
 * Names normalised for comparison only — never for storage or display.
 *
 * Case, surrounding and repeated whitespace, and the punctuation that turns
 * "O'Brien" into "OBrien" and "Anne-Marie" into "Anne Marie". Accents are left
 * alone deliberately: stripping them would fold two genuinely different names
 * together in some languages, and this is used to decide who gets credited for
 * somebody's work.
 */
create or replace function normalise_person_name(raw text)
returns text
language sql
immutable
as $fn$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(lower(coalesce(raw, '')), '[^\w\s]', ' ', 'g'),
      '\s+', ' ', 'g'
    )),
    ''
  );
$fn$;

comment on function normalise_person_name(text) is
  'Lower-cased, punctuation-to-space, whitespace-collapsed form of a person''s '
  'name, for comparison only. Accents are deliberately preserved: folding them '
  'would merge distinct names, and this decides call attribution.';

/*
 * Names somebody has confirmed belong to a given profile.
 *
 * Separate from the exact match below because this is a judgement, not a
 * string property: only a person can say that the "Joshua Jung" on the call
 * sheet is the "Joshua" in the Hub. The note column exists so that judgement
 * is recorded next to the row rather than remembered.
 */
create table call_agent_aliases (
  alias      text primary key,
  user_id    uuid not null references user_profiles (id) on delete cascade,
  note       text not null,
  created_at timestamptz not null default now()
);

comment on table call_agent_aliases is
  'Agent names as they appear on the call sheet, mapped to the Hub profile they '
  'belong to. One row per spelling. Populated only from a confirmed answer — '
  'never from a guess, because a wrong row credits one person for another '
  'person''s calls.';

comment on column call_agent_aliases.alias is
  'Stored already normalised by normalise_person_name. The check below enforces '
  'that, so a hand-inserted row cannot sit here silently never matching.';

alter table call_agent_aliases
  add constraint call_agent_aliases_alias_is_normalised
  check (alias = normalise_person_name(alias));

alter table call_agent_aliases enable row level security;

/*
 * Fills nulls only.
 *
 * A correction made by hand is never undone by a later import, which is the
 * same rule apply_tracker_lead_aliases follows and for the same reason: the
 * import runs on a schedule and the correction does not.
 */
create or replace function resolve_call_summary_agents()
returns integer
language plpgsql
as $fn$
declare
  by_alias integer;
  by_name  integer;
begin
  /*
   * Aliases first, because they are somebody's decision and must beat a name
   * that merely looks similar.
   */
  update call_summaries s
  set agent_user_id = a.user_id
  from call_agent_aliases a
  where s.agent_user_id is null
    and normalise_person_name(s.agent_name) = a.alias;
  get diagnostics by_alias = row_count;

  /*
   * Then an exact match once normalised. NOT a fuzzy match: crediting one
   * agent with another's calls is worse than leaving a row unattributed, and
   * an unattributed row is already visible and badged in the scoreboard.
   *
   * The `= 1` guard is the part that matters. Two profiles whose names
   * normalise to the same string would otherwise both match and the update
   * would take whichever Postgres reached first — silently, and differently on
   * a re-run.
   */
  update call_summaries s
  set agent_user_id = p.id
  from user_profiles p
  where s.agent_user_id is null
    and s.agent_name is not null
    and normalise_person_name(p.full_name) = normalise_person_name(s.agent_name)
    and (
      select count(*) from user_profiles other
      where normalise_person_name(other.full_name)
            = normalise_person_name(s.agent_name)
    ) = 1;
  get diagnostics by_name = row_count;

  return by_alias + by_name;
end;
$fn$;

comment on function resolve_call_summary_agents() is
  'Attaches call_summaries rows to a Hub profile: confirmed aliases first, then '
  'an exact normalised name match guarded against two profiles normalising to '
  'the same name. Fills nulls only, so a correction survives the next import. '
  'Returns the number of rows attached.';

/*
 * Who is still unattributed, and how much of the scoreboard it costs.
 *
 * The existing v_call_summary_unmatched_agents answers "which names did not
 * match". This answers the question that follows it — whether the name has no
 * profile at all, or has one under a different spelling and needs an alias —
 * because those need different actions from different people.
 */
create or replace view v_call_summary_agent_resolution
with (security_invoker = on) as
  select
    s.agent_name,
    normalise_person_name(s.agent_name) as normalised,
    count(*)                            as summaries,
    min(s.called_on)                    as first_call,
    max(s.called_on)                    as last_call,
    exists (
      select 1 from user_profiles p
      where normalise_person_name(p.full_name)
            = normalise_person_name(s.agent_name)
    )                                   as a_profile_matches_this_spelling,
    exists (
      select 1 from call_agent_aliases a
      where a.alias = normalise_person_name(s.agent_name)
    )                                   as an_alias_covers_this_spelling
  from call_summaries s
  where s.agent_user_id is null
    and s.agent_name is not null
  group by s.agent_name;

comment on view v_call_summary_agent_resolution is
  'Unattributed agent names with the reason: whether a profile already matches '
  'the spelling, and whether an alias covers it. Distinguishes "no profile '
  'exists" from "the profile is spelled differently", which need different '
  'fixes.';
