/*
 * The tracker view in under a second.
 *
 * 0088 gave every lead and booking a campaign by looking up, for each
 * (practice, day), the practice's highest-spending campaign in the trailing
 * 30 days. Correct, and expensive: a correlated subquery over ad_level_insights
 * per (practice, day) - 2,700 of them, 160,000 heap blocks - so the view took
 * 4 to 6 seconds through the API. The tracker page reads it five times per
 * load (the table, once per page of 1,000 rows, and three freshness probes),
 * which put a page load past the point where anything arrives. Jemie saw an
 * empty table on every window but the default.
 *
 * Same rule, one pass. The fallback campaign is now the practice's
 * highest-spending campaign in that calendar month, and failing that its
 * highest-spending campaign ever. Both come from one aggregate over the
 * spend rows the view already computes (ins), joined by (practice, month).
 * For the 35 single-campaign practices the answer is identical. For the three
 * multi-campaign practices "this month's biggest" replaces "the trailing 30
 * days' biggest", which differs only when a practice switched campaigns in
 * the last few days of a month.
 *
 * Column list, order and types are unchanged so CREATE OR REPLACE applies.
 */
create or replace view public.v_cft_stats_dashboard as
with own as (
  select distinct client_id, external_id
  from public.campaigns
  where external_id is not null
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
/* The practice's biggest campaign each month, and its biggest ever. */
top_month as (
  select distinct on (client_id, month)
         client_id, month, campaign_external_id
  from (
    select client_id, campaign_external_id,
           date_trunc('month', day)::date as month,
           sum(spend_cents) as spend
    from ins
    group by 1, 2, 3
  ) m
  order by client_id, month, spend desc, campaign_external_id
),
top_ever as (
  select distinct on (client_id)
         client_id, campaign_external_id
  from (
    select client_id, campaign_external_id, sum(spend_cents) as spend
    from ins
    group by 1, 2
  ) a
  order by client_id, spend desc, campaign_external_id
),
crm as (
  select distinct on (client_id, crm_appointment_id)
         client_id, crm_appointment_id, campaign_external_id, booked_at
  from public.appointments
  where crm_appointment_id is not null
  order by client_id, crm_appointment_id, campaign_external_id nulls last
),
lg as (
  select l.*,
         a.campaign_external_id as appt_campaign,
         coalesce(
           (a.booked_at at time zone 'UTC')::date,
           (l.booked_at at time zone 'UTC')::date,
           (l.appointment_at at time zone 'UTC')::date
         ) as booked_day,
         (l.appointment_at at time zone 'UTC')::date as visit_day
  from public.appointment_ledger l
  left join crm a on a.client_id = l.client_id and a.crm_appointment_id = l.crm_appointment_id
  where l.client_id is not null and l.tracker_source_row is null and l.appointment_at is not null
),
lds as (
  select l.client_id,
         case when o.external_id is not null then l.campaign_external_id
              else coalesce(tm.campaign_external_id, te.campaign_external_id) end
           as campaign_external_id,
         l.received_on as day,
         sum(coalesce(l.lead_count, 1)) as leads_tracker
  from public.v_tracker_leads_effective l
  left join own o on o.client_id = l.client_id and o.external_id = l.campaign_external_id
  left join top_month tm on tm.client_id = l.client_id and tm.month = date_trunc('month', l.received_on)::date
  left join top_ever te on te.client_id = l.client_id
  where l.client_id is not null
  group by 1, 2, 3
),
ta as (
  select t.*,
         case when o.external_id is not null then t.campaign_external_id
              else coalesce(tm.campaign_external_id, te.campaign_external_id) end
           as resolved_campaign
  from public.tracker_appointments t
  left join own o on o.client_id = t.client_id and o.external_id = t.campaign_external_id
  left join top_month tm on tm.client_id = t.client_id
                        and tm.month = date_trunc('month', coalesce(t.created_on, t.booked_for))::date
  left join top_ever te on te.client_id = t.client_id
  where t.client_id is not null
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
         case when o.external_id is not null then l.appt_campaign
              else coalesce(tm.campaign_external_id, te.campaign_external_id) end,
         l.booked_day,
         l.visit_day,
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
  from lg l
  left join own o on o.client_id = l.client_id and o.external_id = l.appt_campaign
  left join top_month tm on tm.client_id = l.client_id and tm.month = date_trunc('month', l.booked_day)::date
  left join top_ever te on te.client_id = l.client_id
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
       case
         when g.status = 'churned'::client_status then 'Churned'
         when cl.is_active then 'Active'
         else 'Paused'
       end as status,
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
left join public.client_groups g on g.id = cl.group_id
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
