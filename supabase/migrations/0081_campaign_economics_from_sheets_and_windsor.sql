/*
 * Spend joined to booked patients, on the campaign id.
 *
 * This is the first join in the system that reaches from an ad to a booking,
 * and it exists because of a question Jemie asked rather than anything I found:
 * the bookings are in the practice stat sheets, Windsor already has the spend,
 * and both carry a campaign id. No Meta access needed - which matters, because
 * nobody here has any.
 *
 * WHY CAMPAIGN AND NOT AD. The stat sheets have an "Ad ID" column and it is
 * empty on 41 of 46 practices - 22 real ad ids across roughly 1,113 rows.
 * Campaign ID is populated 121 times by a different mechanism and, checked
 * against the Client Fulfilment Tracker's own campaign list, resolves to the
 * correct practice 21 times out of 21. So campaign grain is the finest grain
 * this data actually supports, and claiming ad grain would be inventing it.
 *
 * WHAT THAT COSTS, said plainly: 200-300 hook/body/CTA combinations inside one
 * campaign per practice are indistinguishable here. To measure them, each
 * combination needs to be its own campaign or ad set - a decision about how the
 * revamp is built, not a column anybody can add afterwards.
 *
 * DATED ON THE DAY THE BOOKING WAS MADE, not the day of the appointment. The ad
 * did its work when somebody booked; an appointment three weeks out belongs to
 * the spend that produced it, not to the spend running when they finally
 * turned up. Falls back to the appointment date only when the sheet has no
 * booked date.
 *
 * UNIONED, NOT INNER-JOINED. A campaign that spent money and booked nobody is
 * the single most important row on here, and an inner join would delete it.
 *
 * Every counter is additive and no ratio is stored. Cost per booking, cost per
 * show and return on spend are computed after summing a window, never averaged
 * across days - a day with one booking and a day with forty do not contribute
 * equally to a cost, and a mean of two costs pretends they do.
 */
create or replace view public.v_campaign_economics
with (security_invoker = on) as
  with spend as (
    select
      cmp.external_id as campaign_external_id,
      i.client_id,
      i.insight_on as day,
      sum(i.spend_cents) as spend_cents,
      sum(i.impressions) as impressions,
      sum(i.clicks) as clicks
    from ad_level_insights i
    join campaigns cmp on cmp.id = i.campaign_id
    where i.client_id is not null
    group by cmp.external_id, i.client_id, i.insight_on
  ), booked as (
    select
      s.campaign_external_id,
      s.client_id,
      coalesce(s.booked_on, s.appointment_on) as day,
      count(*) as bookings,
      count(*) filter (where s.first_consultation_show ilike 'y%') as shows,
      count(*) filter (where s.converted_to_patient ilike 'y%') as converted,
      sum(coalesce(s.treatment_value_cents, 0)) as treatment_value_cents,
      count(*) filter (where s.treatment_value_cents is not null) as valued
    from stat_sheet_appointments s
    where s.campaign_external_id is not null
      and coalesce(s.booked_on, s.appointment_on) is not null
    group by s.campaign_external_id, s.client_id, coalesce(s.booked_on, s.appointment_on)
  ), spine as (
    select campaign_external_id, client_id, day from spend
    union
    select campaign_external_id, client_id, day from booked
  )
  select
    sp.campaign_external_id,
    sp.client_id,
    cl.name           as client_name,
    cl.group_id,
    cmp.name          as campaign_name,
    sp.day,
    coalesce(s.spend_cents, 0)          as spend_cents,
    coalesce(s.impressions, 0)          as impressions,
    coalesce(s.clicks, 0)               as clicks,
    coalesce(b.bookings, 0)             as bookings,
    coalesce(b.shows, 0)                as shows,
    coalesce(b.converted, 0)            as converted,
    coalesce(b.treatment_value_cents, 0) as treatment_value_cents,
    coalesce(b.valued, 0)               as bookings_with_a_value
  from spine sp
  join clients cl on cl.id = sp.client_id
  left join campaigns cmp
    on cmp.external_id = sp.campaign_external_id and cmp.client_id = sp.client_id
  left join spend s
    on s.campaign_external_id = sp.campaign_external_id
   and s.client_id = sp.client_id and s.day = sp.day
  left join booked b
    on b.campaign_external_id = sp.campaign_external_id
   and b.client_id = sp.client_id and b.day = sp.day
  where not cl.is_internal;

comment on view public.v_campaign_economics is
  'Spend from Windsor joined to bookings from the practice stat sheets, on the campaign id both carry. The first join in this system that reaches from an ad to a booked patient - see migration 0081. Unioned, not inner-joined: a campaign that spent and booked nothing still shows its spend.';
