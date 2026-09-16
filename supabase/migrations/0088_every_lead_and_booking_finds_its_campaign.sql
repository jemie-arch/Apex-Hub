/*
 * Every lead and booking on the tracker finds its campaign.
 *
 * The campaign-grain columns of the Client Fulfilment Tracker - Leads, CPL,
 * every appointment column, every cost per outcome - have been hatched out
 * since 0063, because the sheet's campaign id was wrong row by row: leads
 * from 29 practices cited Singleton's campaign. Joshua wants the table filled
 * and he is right that a hatched column is not a tracker. But unhiding the
 * cells would have shown the corruption, so the fix is here, in the view,
 * where the campaign is decided.
 *
 * MEASURED ON 16 SEPTEMBER 2026, LAST 30 DAYS:
 *
 *   sheet leads          1,072 cite their own practice's campaign
 *                           69 cite another practice's campaign
 *                           35 cite none
 *   sheet appointments       7 cite their own practice's campaign
 *                           78 cite another practice's campaign
 *                            3 cite none
 *   practices with spend    35 ran exactly one campaign
 *                            3 ran two or three
 *
 * So the leads' campaign column has become trustworthy (the sheet was fixed
 * upstream at some point after 0063 was written) and the appointments' has
 * not. And for 35 of 38 practices the question "which campaign" has only one
 * possible answer, so the corrupt id can be corrected rather than dropped.
 *
 * THE RULE, applied to a lead, a sheet appointment and a CRM appointment alike:
 *
 *   1. If the row cites a campaign that belongs to its own practice, keep it.
 *   2. Otherwise give it the practice's own campaign with the most spend in
 *      the 30 days up to that day; failing that, the most spend ever.
 *   3. A practice with no campaign at all keeps a null, which the table shows
 *      as "(no campaign)".
 *
 * For the 35 single-campaign practices step 2 is exact. For SMYLE, Kind
 * Dental and Village Dental it puts an unattributed booking on the campaign
 * that was spending most that month, which is the likeliest answer and is
 * recorded here as an estimate, not a fact. Their leads are unaffected -
 * they cite their own campaigns.
 *
 * CRM appointments (the ledger rows with no sheet row) used to carry no
 * campaign at all and so sat on "(no campaign)". They now take the campaign
 * the stat-sheet enrichment wrote onto appointments (0082) when it is the
 * practice's own, and the rule's fallback otherwise.
 *
 * Totals do not change. Every lead, booking and dollar is still counted once;
 * only the campaign row it sits on moves. Verified before and after apply.
 *
 * Column list, order and types are unchanged so CREATE OR REPLACE applies.
 */
create or replace view public.v_cft_stats_dashboard as
with own as (
  select distinct client_id, external_id
  from public.campaigns
  where external_id is not null
),
/* Every (practice, day) that has a lead or booking to place. */
days as (
  select client_id, received_on as day
  from public.v_tracker_leads_effective
  where client_id is not null
  union
  select client_id, coalesce(created_on, booked_for)
  from public.tracker_appointments
  where client_id is not null
  union
  select client_id, (appointment_at at time zone 'UTC')::date
  from public.appointment_ledger
  where client_id is not null and tracker_source_row is null and appointment_at is not null
),
/* The practice's own campaign with the most spend in the trailing 30 days, else ever. */
fb as (
  select d.client_id, d.day, x.external_id as campaign_external_id
  from days d
  left join lateral (
    select cmp.external_id
    from public.ad_level_insights i
    join public.campaigns cmp on cmp.id = i.campaign_id
    where i.client_id = d.client_id
    group by cmp.external_id
    order by
      coalesce(sum(i.spend_cents) filter (where i.insight_on between d.day - 30 and d.day), 0) desc,
      sum(i.spend_cents) desc,
      cmp.external_id
    limit 1
  ) x on true
),
ins as (
  select i.client_id,
         cmp.external_id as campaign_external_id,
         i.insight_on as day,
         sum(i.spend_cents) as spend_cents,
         sum(i.impressions) as impressions,
         sum(i.clicks) as clicks,
         sum(i.leads) as leads_windsor
  from public.ad_level_insights i
  join public.campaigns cmp on cmp.id = i.campaign_id
  where i.client_id is not null
  group by i.client_id, cmp.external_id, i.insight_on
),
lds as (
  select l.client_id,
         case when o.external_id is not null then l.campaign_external_id else f.campaign_external_id end
           as campaign_external_id,
         l.received_on as day,
         sum(coalesce(l.lead_count, 1)) as leads_tracker
  from public.v_tracker_leads_effective l
  left join own o on o.client_id = l.client_id and o.external_id = l.campaign_external_id
  left join fb f on f.client_id = l.client_id and f.day = l.received_on
  where l.client_id is not null
  group by 1, 2, 3
),
/* Sheet appointments with their campaign resolved by the rule. */
ta as (
  select t.*,
         case when o.external_id is not null then t.campaign_external_id else f.campaign_external_id end
           as resolved_campaign
  from public.tracker_appointments t
  left join own o on o.client_id = t.client_id and o.external_id = t.campaign_external_id
  left join fb f on f.client_id = t.client_id and f.day = coalesce(t.created_on, t.booked_for)
  where t.client_id is not null
),
/* One row per CRM appointment, carrying what the stat sheets wrote onto it. */
crm as (
  select distinct on (client_id, crm_appointment_id)
         client_id, crm_appointment_id, campaign_external_id
  from public.appointments
  where crm_appointment_id is not null
  order by client_id, crm_appointment_id, campaign_external_id nulls last
),
appt_src as (
  select t.client_id,
         t.resolved_campaign as campaign_external_id,
         coalesce(t.created_on, t.booked_for) as day,
         t.booked_for,
         true as from_tracker,
         t.appointment_status is null as is_pending,
         t.appointment_status = 'Showed' as is_show,
         t.appointment_status = 'No Show' as is_no_show,
         t.status_if_showed = 'DQ' as is_dq,
         t.status_if_showed = 'Closed' as is_close,
         t.status_if_showed = 'Follow up' as is_follow_up,
         l.cancelled_at is not null as is_cancel,
         l.id is null as not_in_ledger,
         l.amount_cents as revenue_cents
  from ta t
  left join public.appointment_ledger l
    on l.client_id = t.client_id and l.tracker_source_row = t.source_row
  union all
  select l.client_id,
         case when o.external_id is not null then a.campaign_external_id else f.campaign_external_id end,
         (l.appointment_at at time zone 'UTC')::date,
         (l.appointment_at at time zone 'UTC')::date,
         false,
         l.outcome = 'pending'::ledger_outcome,
         l.outcome = 'showed'::ledger_outcome,
         l.outcome = 'no_show'::ledger_outcome,
         false,
         false,
         false,
         l.cancelled_at is not null,
         false,
         l.amount_cents
  from public.appointment_ledger l
  left join crm a on a.client_id = l.client_id and a.crm_appointment_id = l.crm_appointment_id
  left join own o on o.client_id = l.client_id and o.external_id = a.campaign_external_id
  left join fb f on f.client_id = l.client_id and f.day = (l.appointment_at at time zone 'UTC')::date
  where l.client_id is not null and l.tracker_source_row is null and l.appointment_at is not null
),
appt as (
  select client_id, campaign_external_id, day,
         count(*) as appts_created,
         count(*) filter (where from_tracker) as appts_tracker,
         count(*) filter (where is_pending) as appts_pending,
         max(booked_for) as last_appt_date,
         count(*) filter (where is_show) as shows,
         count(*) filter (where is_no_show) as no_shows,
         count(*) filter (where is_dq) as dqs,
         count(*) filter (where is_close) as closes,
         count(*) filter (where is_follow_up) as follow_ups,
         count(*) filter (where is_cancel) as cancels,
         count(*) filter (where not_in_ledger) as appts_not_in_ledger,
         sum(coalesce(revenue_cents, 0)) as revenue_cents
  from appt_src
  group by client_id, campaign_external_id, day
),
ofr as (
  select client_id, resolved_campaign as campaign_external_id,
         mode() within group (order by offer_name) as offer_name
  from ta
  where offer_name is not null
  group by client_id, resolved_campaign
),
spine as (
  select client_id, campaign_external_id, day from ins
  union
  select client_id, campaign_external_id, day from lds
  union
  select client_id, campaign_external_id, day from appt
)
select null::text as notes,
       case when cl.is_active then 'Active' else 'Paused' end as status,
       cl.name as client_name,
       cmp.name as campaign_name,
       s.campaign_external_id as campaign_id_external,
       o.offer_name,
       s.client_id,
       cl.group_id,
       cl.is_active,
       cmp.id as campaign_uuid,
       cmp.status as campaign_status,
       s.day,
       coalesce(i.spend_cents, 0::bigint) as spend_cents,
       coalesce(i.impressions, 0::bigint) as impressions,
       coalesce(i.clicks, 0::bigint) as clicks,
       coalesce(i.leads_windsor, 0::bigint) as leads_windsor,
       coalesce(l.leads_tracker, 0::bigint) as leads_tracker,
       greatest(coalesce(i.leads_windsor, 0::bigint), coalesce(l.leads_tracker, 0::bigint)) as leads_best,
       coalesce(a.appts_created, 0::bigint) as appts_created,
       coalesce(a.appts_pending, 0::bigint) as appts_to_be_taken,
       a.last_appt_date,
       coalesce(a.shows, 0::bigint) as shows,
       coalesce(a.no_shows, 0::bigint) as no_shows,
       coalesce(a.cancels, 0::bigint) as cancels,
       coalesce(a.dqs, 0::bigint) as dqs,
       coalesce(a.follow_ups, 0::bigint) as follow_ups,
       coalesce(a.appts_not_in_ledger, 0::bigint) as appts_not_in_ledger,
       coalesce(a.closes, 0::bigint) as closes,
       nullif(coalesce(a.revenue_cents, 0::bigint), 0) as revenue_cents,
       coalesce(a.appts_tracker, 0::bigint) as appts_tracker
from spine s
join public.clients cl on cl.id = s.client_id
left join public.campaigns cmp
  on cmp.client_id = s.client_id and not cmp.external_id is distinct from s.campaign_external_id
left join ins i
  on i.client_id = s.client_id and not i.campaign_external_id is distinct from s.campaign_external_id and i.day = s.day
left join lds l
  on l.client_id = s.client_id and not l.campaign_external_id is distinct from s.campaign_external_id and l.day = s.day
left join appt a
  on a.client_id = s.client_id and not a.campaign_external_id is distinct from s.campaign_external_id and a.day = s.day
left join ofr o
  on o.client_id = s.client_id and not o.campaign_external_id is distinct from s.campaign_external_id
where not cl.is_internal;

comment on view public.v_cft_stats_dashboard is
  'One row per practice, campaign and day for the Client Fulfilment Tracker. A lead or booking that cites another practice''s campaign, or none, is placed on its own practice''s highest-spending campaign of the trailing 30 days (see 0088). Totals are unaffected; only the campaign row moves.';
