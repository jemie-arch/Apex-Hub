-- ===========================================================================
-- Match clinics to sheets on identity, not on similarity.
--
-- 0014 shipped pps_routing_candidates scoring name pairs with pg_trgm and
-- bucketing them into near-exact / likely / needs-a-human. The first run against
-- real data showed that was unsafe:
--
--   "Cruz Orthodontics"    vs "Ofir Orthodontics"    scored 0.59  -> "likely"
--   "City Dental Centers"  vs "SMYLE Dental Centers" scored 0.58  -> "likely"
--   "Smile Orthodontics"   vs "Ofir Orthodontics"    scored 0.57  -> "likely"
--
-- Any threshold that accepted those would route one practice's patients into
-- another practice's sheet — the precise fault the routing table exists to
-- retire. The reason is structural rather than a tuning problem: nearly every
-- name in this population contains "Dental" or "Orthodontics", so character
-- overlap carries almost no information about identity.
--
-- Replaced with normalised equality. Two names match when they are the same
-- string once case, punctuation, the "Z." churned-client prefix and trailing
-- company suffixes are removed. Containment is reported but never treated as a
-- match, because here it usually means a sibling: "Kind Dental" is contained in
-- "Kind Dental (GD)" and those are two practices with two different sheets.
--
-- Dropped rather than replaced because create-or-replace cannot rename a view
-- column, and pps_routing_gaps depends on the shape, so both go in order.
-- ===========================================================================

drop view if exists pps_routing_gaps;
drop view if exists pps_routing_candidates;

create or replace function pps_normalise_practice(name text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(name, '')), '^\s*z\.\s*', ''),
             '\s+(llc|pllc|inc|pa|pc|dds|dmd)\.?\s*$', ''
           ),
           '[^a-z0-9]+', '', 'g'
         );
$$;

comment on function pps_normalise_practice is
  'Strips case, punctuation, the "Z." churned-client prefix and trailing company suffixes so two spellings of one practice compare equal. Deliberately blunt: it decides identity, so it must not be clever enough to make two different practices look the same.';

create view pps_routing_candidates as
with pairs as (
  select
    c.id                    as client_id,
    c.name                  as practice,
    c.crm_location_id,
    p.scenario_id,
    p.folder                as scenario_practice,
    p.primary_sheet_id      as spreadsheet_id,
    pps_normalise_practice(c.name)   as norm_client,
    pps_normalise_practice(p.folder) as norm_scenario
  from clients c
  cross join scenario_primary_sheet p
  where c.is_active
    and c.crm_location_id is not null
    and p.folder is not null
),
scored as (
  select
    pairs.*,
    case
      when norm_client = norm_scenario then 'exact'
      -- Reported, never trusted. The length floor keeps two-word generic names
      -- from matching half the estate.
      when length(norm_client) >= 10
        and (norm_scenario like norm_client || '%'
             or norm_client like norm_scenario || '%')
        then 'one name contains the other - check it is not a sibling practice'
      else null
    end as match_kind
  from pairs
)
select
  client_id,
  practice,
  crm_location_id,
  scenario_id,
  scenario_practice,
  spreadsheet_id,
  match_kind,
  match_kind = 'exact' as is_exact,
  exists (select 1 from pps_clinic_routing r where r.client_id = scored.client_id)
    as already_routed
from scored
where match_kind is not null
order by practice, (match_kind = 'exact') desc, scenario_practice;

comment on view pps_routing_candidates is
  'Clinic-to-sheet proposals matched on normalised name identity, not similarity. is_exact means the names are the same practice once punctuation and suffixes are removed; anything else is a containment hint needing a person, because in this population containment usually means a sibling practice with its own sheet. Nothing here is written to pps_clinic_routing automatically.';

create view pps_routing_gaps as
select
  c.id                as client_id,
  c.name              as practice,
  c.crm_location_id,
  case
    when c.crm_location_id is null
      then 'no GoHighLevel location id, so a booking cannot be matched to it'
    when r.client_id is null
      then 'no routing row yet'
    when r.spreadsheet_id is null
      then 'routing row exists but names no sheet'
    when r.verified_at is null
      then 'proposed but not verified, so deliberately not in use'
    else 'sheet is claimed by another clinic too'
  end                 as gap,
  (select count(*) from pps_routing_candidates k
    where k.client_id = c.id and k.is_exact) as exact_candidates,
  (select count(*) from pps_routing_candidates k
    where k.client_id = c.id) as all_candidates
from clients c
left join pps_clinic_routing r on r.client_id = c.id
where c.is_active
  and not exists (
    select 1 from pps_routing_export e
    where e.crm_location_id = c.crm_location_id
  )
order by c.name;

comment on view pps_routing_gaps is
  'Active clinics the consolidated booking scenario could not route today, with the reason and how many proposals exist. Has to reach zero before the 56 cloned scenarios can be retired.';
