-- Attach RAW DATA rows to an agent and a practice.
--
-- The twin of resolve_call_summary_agents, and deliberately a separate function
-- rather than one taking a table name: dynamic SQL to save fifteen lines of
-- UPDATE would make the thing that decides what people are paid harder to read.
-- If you change the matching rule in one, change it in the other.
--
-- Fills nulls only, so a correction made by hand outlives the next import.
--
-- TWO THINGS THIS LEARNED THE HARD WAY, both on the first live run over 12,563
-- rows:
--
-- 1. NO PER-ROW AMBIGUITY SUBQUERY. The first version copied
--    apply_tracker_lead_aliases, which guards ambiguity by counting matching
--    clients in a correlated subquery. That is fine over the tracker's 1,879
--    leads and fatal here: it calls pps_normalise_practice once per
--    (row x client) pair, the statement was cancelled on timeout, and all
--    12,563 rows were left credited to nobody. The tables being matched against
--    are tiny — about 40 clients, a dozen roster entries — so they are
--    normalised ONCE into a CTE, carry their own duplicate count, and hash join.
--
-- 2. Postgres has no min() for uuid. (array_agg(id))[1] instead, which is safe
--    only because the matches = 1 guard means the array holds one element.

create or replace function resolve_raw_call_attribution()
returns integer
language plpgsql
as $fn$
declare
  by_alias    integer;
  by_name     integer;
  by_practice integer;
begin
  /* Confirmed aliases first — somebody's decision beats a lookalike name. */
  update raw_call_rows r
  set agent_id = a.agent_id
  from call_agent_aliases a
  where r.agent_id is null
    and normalise_person_name(r.agent_name) = a.alias;
  get diagnostics by_alias = row_count;

  /*
   * Then an exact match on the normalised roster name. No ambiguity guard
   * needed: call_agents_name_key makes two active roster entries normalising to
   * the same name impossible.
   */
  with roster as (
    select id, normalise_person_name(display_name) as norm
    from call_agents
    where is_active
  )
  update raw_call_rows r
  set agent_id = g.id
  from roster g
  where r.agent_id is null
    and r.agent_name is not null
    and normalise_person_name(r.agent_name) = g.norm;
  get diagnostics by_name = row_count;

  /*
   * The practice, from the location name the scenario writes. Two practices
   * whose names normalise alike are skipped entirely — attaching to whichever
   * Postgres reached first would be silent and would differ between runs.
   */
  with practice as (
    select
      pps_normalise_practice(name) as norm,
      (array_agg(id))[1]           as id,
      count(*)                     as matches
    from clients
    group by pps_normalise_practice(name)
  )
  update raw_call_rows r
  set client_id = p.id
  from practice p
  where r.client_id is null
    and r.location_name is not null
    and p.matches = 1
    and pps_normalise_practice(r.location_name) = p.norm;
  get diagnostics by_practice = row_count;

  return by_alias + by_name + by_practice;
end;
$fn$;

comment on function resolve_raw_call_attribution() is
  'Attaches raw_call_rows to a call_agents roster entry (confirmed aliases '
  'first, then an exact normalised name match) and to a client (exact '
  'normalised practice name, skipped where two practices normalise alike). '
  'Fills nulls only. Twin of resolve_call_summary_agents — change the matching '
  'rule in one and change it in the other. Deliberately does NOT use the '
  'per-row ambiguity subquery those functions use: over 12,563 rows it times '
  'out and attributes nothing.';

/*
 * Agent names in RAW DATA that reached no roster entry.
 *
 * More consequential than its call_summaries equivalent: an unrostered name
 * here is bookings credited to nobody, which is somebody's commission. The
 * first live run found eight names the roster had never heard of, because the
 * roster was built from call_summaries and that tab only ever saw five — among
 * the missing was Ayanda Ndlovu, with 3,096 calls and 82 bookings, who is one
 * of the two agents on the pay dashboard.
 */
create or replace view v_raw_call_unattributed as
  select
    r.agent_name,
    normalise_person_name(r.agent_name)                     as normalised,
    count(*)                                                as rows,
    count(*) filter (where r.disposition ilike '%booked%')   as booked_rows,
    min(r.called_on)                                        as first_call,
    max(r.called_on)                                        as last_call,
    exists (
      select 1 from call_agents g
      where normalise_person_name(g.display_name)
            = normalise_person_name(r.agent_name)
    )                                                        as a_roster_entry_matches
  from raw_call_rows r
  where r.agent_id is null
    and r.agent_name is not null
  group by r.agent_name;

comment on view v_raw_call_unattributed is
  'RAW DATA rows that reached no roster entry, with how many are bookings. '
  'Non-empty means somebody is making bookings the Hub cannot credit to a '
  'person, which is a pay problem rather than a reporting one.';
