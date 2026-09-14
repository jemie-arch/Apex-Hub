/*
 * Schedule % read 121.3% — more appointments than leads.
 *
 * A conversion rate cannot exceed 100%, and this one did because its numerator
 * and denominator count different populations.
 *
 * Appointments arrive from two sources, unioned in appt_src:
 *
 *   tracker_appointments   1,273, of which 1,085 carry a campaign id
 *   appointment_ledger     1,420, campaign forced to NULL - these are CRM
 *                          bookings the tracker sheet never recorded
 *
 * Leads arrive from the tracker and from Windsor, and every one of them sits on
 * a (client, campaign, day) row. The 1,420 ledger appointments sit on rows with
 * no campaign, no spend and no leads, so at client grain the sum mixed
 * appointments that came from counted leads with appointments that did not.
 * 2,693 over 2,220 is not a rate; it is two different questions divided.
 *
 * appts_tracker is the matched population: appointments from the same feed the
 * leads come from. Schedule % uses it, so the column finally answers the
 * question it is headed with - of the leads we generated, how many booked.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * appts_created keeps counting all 2,693. Those ledger bookings are real
 * appointments that real practices really took, and dropping them from the
 * count would be a worse lie than the ratio was. Show %, No Show %, DQ % and
 * Cancel % all divide outcomes by appts_created and stay on it: outcomes and
 * appointments come from the same rows, so those rates were never mismatched.
 *
 * Cost Per Booking still divides spend by appts_created, and that IS a
 * mismatch of the same family - spend exists only on campaign rows. Left alone
 * on purpose: it understates cost rather than overstating it, the choice
 * between "cost per booking we paid for" and "cost per booking we got" is
 * Joshua's to make rather than mine, and unlike 121% neither answer is
 * impossible. Flagged in the SOP instead of changed quietly.
 */
create or replace view public.v_cft_stats_dashboard as
select q.*
from (
  with ins as (
    select i.client_id, cmp.external_id as campaign_external_id, i.insight_on as day,
           sum(i.spend_cents) as spend_cents, sum(i.impressions) as impressions,
           sum(i.clicks) as clicks, sum(i.leads) as leads_windsor
    from ad_level_insights i
    join campaigns cmp on cmp.id = i.campaign_id
    where i.client_id is not null
    group by i.client_id, cmp.external_id, i.insight_on
  ), lds as (
    select client_id, campaign_external_id, received_on as day,
           sum(coalesce(lead_count, 1)) as leads_tracker
    from v_tracker_leads_effective
    where client_id is not null
    group by client_id, campaign_external_id, received_on
  ), appt_src as (
    select t.client_id, t.campaign_external_id,
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
           l.id is null as not_in_ledger
    from tracker_appointments t
    left join appointment_ledger l
      on l.client_id = t.client_id and l.tracker_source_row = t.source_row
    where t.client_id is not null
    union all
    select l.client_id, null::text,
           (l.appointment_at at time zone 'UTC')::date,
           (l.appointment_at at time zone 'UTC')::date,
           false,
           l.outcome = 'pending'::ledger_outcome,
           l.outcome = 'showed'::ledger_outcome,
           l.outcome = 'no_show'::ledger_outcome,
           false, false, false,
           l.cancelled_at is not null,
           false
    from appointment_ledger l
    where l.client_id is not null
      and l.tracker_source_row is null
      and l.appointment_at is not null
  ), appt as (
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
           count(*) filter (where not_in_ledger) as appts_not_in_ledger
    from appt_src
    group by client_id, campaign_external_id, day
  ), ofr as (
    select client_id, campaign_external_id,
           mode() within group (order by offer_name) as offer_name
    from tracker_appointments
    where client_id is not null and offer_name is not null
    group by client_id, campaign_external_id
  ), spine as (
    select client_id, campaign_external_id, day from ins
    union select client_id, campaign_external_id, day from lds
    union select client_id, campaign_external_id, day from appt
  )
  select
    null::text as notes,
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
    null::bigint as revenue_cents,
    -- Appended: appointments from the tracker feed, the population that pairs
    -- with leads. See the header for why Schedule % needs it.
    coalesce(a.appts_tracker, 0::bigint) as appts_tracker
  from spine s
  join clients cl on cl.id = s.client_id
  left join campaigns cmp on cmp.client_id = s.client_id
    and not cmp.external_id is distinct from s.campaign_external_id
  left join ins i on i.client_id = s.client_id
    and not i.campaign_external_id is distinct from s.campaign_external_id and i.day = s.day
  left join lds l on l.client_id = s.client_id
    and not l.campaign_external_id is distinct from s.campaign_external_id and l.day = s.day
  left join appt a on a.client_id = s.client_id
    and not a.campaign_external_id is distinct from s.campaign_external_id and a.day = s.day
  left join ofr o on o.client_id = s.client_id
    and not o.campaign_external_id is distinct from s.campaign_external_id
) q
join clients c on c.id = q.client_id
where not c.is_internal;
