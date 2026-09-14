/*
 * Conversation % was dividing inbound calls by outbound dials.
 *
 * calls_2min counts every call of two minutes or more in EITHER direction, and
 * the tracker divides it by dialed_calls, which is outbound only. 50 of the
 * fleet's 606 long calls are inbound, so the rate reads 9.1% where the true
 * outbound figure is 8.3%.
 *
 * Small next to the Pickup % error fixed alongside this, and the same mistake
 * underneath: a numerator and a denominator that count different populations.
 * It also flatters us in the one direction nobody would check, because inbound
 * callers are people who rang US and are far likelier to talk for two minutes.
 *
 * calls_2min is left exactly as it is. Column K of the tracker is headed
 * "Calls 2+ minutes" and means all of them, which is correct for a count of
 * long calls; only the RATE needs the matching population. Appended rather
 * than altered, which is also the only thing CREATE OR REPLACE VIEW permits.
 */
create or replace view public.v_cft_call_daily as
  select
    c.client_id,
    cl.name as client_name,
    cl.group_id,
    c.started_at::date as day,
    count(*) as calls_total,
    count(*) filter (where c.direction::text = 'outbound') as dialed_calls,
    count(*) filter (where c.direction::text = 'inbound') as inbound_calls,
    count(*) filter (
      where c.direction::text = 'outbound' and c.outcome::text = 'connected'
    ) as connected_outbound,
    count(*) filter (where c.outcome::text = 'connected') as connected_any,
    count(*) filter (where coalesce(c.duration_seconds, 0) >= 120) as calls_2min,
    coalesce(sum(c.speed_to_lead_minutes) filter (
      where c.speed_to_lead_minutes >= 0 and c.speed_to_lead_minutes <= 1440
    ), 0) as speed_to_lead_min_sum,
    count(*) filter (
      where c.speed_to_lead_minutes >= 0 and c.speed_to_lead_minutes <= 1440
    ) as speed_to_lead_n,
    count(*) filter (where c.speed_to_lead_minutes > 1440) as speed_to_lead_over_24h,
    count(*) filter (
      where c.direction::text = 'outbound' and coalesce(c.duration_seconds, 0) > 0
    ) as answered_outbound,
    count(*) filter (
      where c.direction::text = 'outbound'
        and c.outcome::text = 'connected'
        and coalesce(c.duration_seconds, 0) = 0
    ) as connected_but_silent,

    -- Appended below the existing columns, the only place CREATE OR REPLACE
    -- VIEW allows a new one. The denominator for Conversation % is outbound,
    -- so its numerator has to be too.
    count(*) filter (
      where c.direction::text = 'outbound' and coalesce(c.duration_seconds, 0) >= 120
    ) as calls_2min_outbound
  from calls c
  join clients cl on cl.id = c.client_id
  where c.started_at is not null
  group by c.client_id, cl.name, cl.group_id, (c.started_at::date);
