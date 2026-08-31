-- A calendar cannot be both excluded and named as an override.
--
-- Kind Dental has "Ortho & New Patient Exam | Dr. Vohra" in excluded_calendars
-- (by id) and in included_calendars (by name). The appointments sync applies the
-- exclusion, so that calendar is never read, so the practice sits at zero
-- appointments while being billed for twenty-seven consultations.
--
-- crm-appointments.ts already carries a comment about this exact pair — the fix
-- there made the missing-calendar alert stop contradicting the fetch, so the
-- problem became visible instead of being covered up. It did not resolve the
-- contradiction in the data, because it could not: which list is right is a
-- judgement about whether that calendar holds PPS consultations.
--
-- This view exists so the contradiction is a row somebody can look at rather than
-- a comment in a sync nobody reads. It answers "which practices are silently
-- losing appointments to a list conflict", which is the question that took a day
-- to answer by hand.
--
-- Deliberately not a constraint. A cross-table exclusion constraint would reject
-- the write that creates the conflict, and the person adding an override
-- legitimately may not know an exclusion exists — failing their insert teaches
-- them nothing. A visible list lets the conflict be resolved on purpose.
create or replace view calendar_list_conflicts as
with pairs as (
  -- Matched by id where both rows carry one, by client and trimmed name otherwise,
  -- because included_calendars rows are frequently name-only.
  select
    c.id                                   as client_id,
    c.name                                 as practice,
    coalesce(e.crm_calendar_id, i.crm_calendar_id) as crm_calendar_id,
    coalesce(nullif(trim(e.calendar_name), ''), trim(i.calendar_name)) as calendar_name,
    i.reason                               as override_reason,
    case
      when e.crm_calendar_id is not null and i.crm_calendar_id is not null
        then 'both lists name the same calendar id'
      else 'both lists name the same calendar by name'
    end                                    as how_matched
  from excluded_calendars e
  join included_calendars i
    on i.client_id = e.client_id
   and (
        (e.crm_calendar_id is not null and i.crm_calendar_id = e.crm_calendar_id)
     or (i.crm_calendar_id is null
         and lower(trim(i.calendar_name)) = lower(trim(e.calendar_name)))
   )
  join clients c on c.id = e.client_id
)
select
  p.*,
  (select count(*) from appointments a where a.client_id = p.client_id) as appointments_held,
  (select count(*) from billing_charges b where b.client_id = p.client_id) as charges_held,
  (select coalesce(sum(b.consult_count), 0) from billing_charges b
    where b.client_id = p.client_id) as consults_billed
from pairs p
order by p.practice, p.calendar_name;

comment on view calendar_list_conflicts is
  'Calendars that are excluded and overridden at the same time. The appointments sync applies the exclusion, so these practices lose appointments quietly — compare appointments_held against consults_billed to see what it is costing. Resolving one means deciding whether that calendar holds PPS consultations, then deleting the losing row.';
