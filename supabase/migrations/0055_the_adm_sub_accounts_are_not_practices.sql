-- The ADM sub-accounts are not practices.
--
-- crm-leads read sixty sub-accounts and counted the contacts of all of them as
-- client leads. Three of those are Apex's own:
--
--   ADM Team Management            100 leads
--   ADM Sales Account                4
--   ADM Client Onboarding Account    1
--
-- 105 of 617, seventeen per cent, and not one of them a dental patient. They
-- are team members, sales prospects and onboarding records — the contacts of
-- the agency's own tooling.
--
-- ADM Team Management is also the account that broke the last two runs. It is
-- the only sub-account with more than a page of contacts in a fortnight, so it
-- was the only one paging was ever attempted on: it truncated at exactly 100
-- on one run and returned a 400 on the next. The paging bug's only victim was
-- an account that should never have been read.
--
-- 0017 already has the column and the convention: is_internal means "not a
-- practice — a test account, another agency, a vendor, an internal product
-- account or a hiring account", set EXPLICITLY rather than inferred, because
-- the only data signal is having no appointments and no charges and a newly
-- signed clinic looks identical.
--
-- These seven are explicit in the same way. Every one is named for the agency
-- itself, every one is inactive, and each is a piece of Apex's own GoHighLevel
-- furniture rather than somewhere patients are booked.

update clients set is_internal = true
where name in (
  'ADM Team Management',
  'ADM Sales Account',
  'ADM Client Onboarding Account',
  'ADM Ortho Snapshot',
  'ADM Push Updates',
  'ADM Team Reports',
  'ADM Testing Grounds'
);

/*
 * Asserted, because the whole point is what is now excluded.
 *
 * Named rather than pattern-matched — an "ADM%" LIKE would catch a future
 * client whose practice name happens to begin with those letters, and quietly
 * remove them from every count that filters on this column.
 */
do $$
declare
  marked   integer;
  polluted integer;
begin
  select count(*) into marked
  from clients
  where is_internal
    and name like 'ADM %';

  if marked <> 7 then
    raise exception
      'Expected 7 ADM sub-accounts marked internal, found %. One has been '
      'renamed; match it by crm_location_id rather than by name.', marked;
  end if;

  /*
   * Leads already imported against them. Left in place: crm_leads is a record
   * of what GoHighLevel held, and deleting rows to change a total is how a
   * number stops being reproducible. Every count of leads joins clients and
   * can now exclude them, which is the honest way to stop counting something.
   */
  select count(*) into polluted
  from crm_leads l
  join clients c on c.id = l.client_id
  where c.is_internal;

  raise notice
    '% lead row(s) already imported against an internal sub-account. They stay '
    'in crm_leads and are excluded by the reporting join.', polluted;
end
$$;

/*
 * And the reconciliation view, which counted them.
 *
 * crm_leads is joined to clients for the practice name already, so the filter
 * costs nothing — it simply stops the agency's own team appearing as a
 * practice's leads and understating its cost per lead.
 */
create or replace view v_lead_reconciliation
with (security_invoker = on) as
  with crm as (
    select l.client_id, l.created_on as day, count(*) as crm_leads
    from crm_leads l
    join clients c on c.id = l.client_id
    where not c.is_internal
    group by l.client_id, l.created_on
  ),
  sheet as (
    select client_id, received_on as day, sum(coalesce(lead_count, 1)) as sheet_leads
    from v_tracker_leads_effective
    where client_id is not null
    group by client_id, received_on
  ),
  meta as (
    select client_id, insight_on as day, sum(leads) as windsor_leads
    from ad_level_insights
    where client_id is not null
    group by client_id, insight_on
  ),
  spine as (
    select client_id, day from crm
    union select client_id, day from sheet
    union select client_id, day from meta
  )
  select
    s.client_id,
    c.name as client_name,
    c.group_id,
    s.day,
    coalesce(m.windsor_leads, 0)::bigint as windsor_leads,
    coalesce(t.sheet_leads, 0)::bigint   as sheet_leads,
    coalesce(g.crm_leads, 0)::bigint     as crm_leads,
    greatest(
      coalesce(m.windsor_leads, 0),
      coalesce(t.sheet_leads, 0)
    )::bigint as leads_best_reported,
    (greatest(coalesce(m.windsor_leads, 0), coalesce(t.sheet_leads, 0))
      - coalesce(g.crm_leads, 0))::bigint as reported_minus_crm
  from spine s
    join clients c on c.id = s.client_id
    left join crm   g on g.client_id = s.client_id and g.day = s.day
    left join sheet t on t.client_id = s.client_id and t.day = s.day
    left join meta  m on m.client_id = s.client_id and m.day = s.day;

comment on view v_lead_reconciliation is
  'One row per practice per day with all three lead counts and the gap. '
  'crm_leads is the reference: it is the only source that records a lead when '
  'it arrives rather than when somebody types it or Meta decides to report it. '
  'Internal sub-accounts are excluded — the agency''s own Team Management '
  'account alone contributed 100 of the first 617 CRM leads. '
  'reported_minus_crm is signed: negative means the Hub reports more leads than '
  'the CRM holds, which is a different problem from reporting fewer. '
  'Sheet leads come from v_tracker_leads_effective, so a lead in two tabs is '
  'counted once.';
