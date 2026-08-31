-- Which GoHighLevel sub-accounts are not clinics.
--
-- The routing gaps list is meant to be driven to zero. It could not be: it
-- included eight sub-accounts that are not practices at all — team test
-- accounts, another agency, a vendor, Apex's own product account, a hiring
-- account. No routing row will ever exist for PNW Survival Games, so the list
-- had a floor above zero and stopped meaning anything.
--
-- Deliberately a flag and not a heuristic. The only thing separating those eight
-- from a real clinic in the data is that they have no appointments and no
-- charges — and so does a practice that signed last week. Filtering on activity
-- would have hidden exactly the new clinic the list exists to surface. An
-- explicit flag is reversible, inspectable, and cannot silently swallow a real
-- practice.
--
-- Set by exact name, which is a judgement made on 31 Aug 2026. If one of these
-- is actually a client, clear the flag rather than working around it.
alter table clients
  add column if not exists is_internal boolean not null default false;

comment on column clients.is_internal is
  'This GoHighLevel sub-account is not a practice — a test account, another agency, a vendor, an internal product account or a hiring account. Set explicitly rather than inferred: the only data signal is having no appointments and no charges, which a newly signed clinic also has, so inferring it would hide the very clients the routing gaps list exists to surface.';

update clients set is_internal = true
where name in (
  'Earl Clinic',
  'Earl Clinic 2',
  'PNW Survival Games',
  'PNW Survival Games 2',
  'Pearl AI',
  'HIP Creative, Inc.',
  'Pay Per Show System',
  'Singleton Smile [Hiring Account]'
);

-- Kept inspectable rather than silently applied, so the exclusion can be
-- audited without reading this migration.
create or replace view pps_routing_internal_excluded as
select id as client_id, name as practice, crm_location_id
from clients
where is_internal
order by name;

comment on view pps_routing_internal_excluded is
  'The sub-accounts pps_routing_gaps leaves out because they are not practices. Exists so the exclusion is visible rather than buried in a where clause.';

-- Rebuild gaps excluding them. Column list is unchanged, so replace is fine.
create or replace view pps_routing_gaps as
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
  and not c.is_internal
  and not exists (
    select 1 from pps_routing_export e
    where e.crm_location_id = c.crm_location_id
  )
order by c.name;

comment on view pps_routing_gaps is
  'Active practices the consolidated booking scenario could not route today, with the reason and how many proposals exist. Excludes sub-accounts flagged is_internal — see pps_routing_internal_excluded. Has to reach zero before the cloned scenarios can be retired, and now actually can.';
