-- A zero-second call is not a pickup.
--
-- v_cft_call_daily reports connected_outbound as outbound calls whose outcome
-- is 'connected', and over the thirty days to 7 September that was 2,233 of
-- 2,270 dials — a 98.4% pickup rate on outbound cold calls, which is not a
-- thing that happens.
--
-- 1,299 of those 2,233 have duration_seconds = 0.
--
-- The cause is upstream, in sync/crm-calls: GoHighLevel reports a call status
-- of 'completed', which mapOutcome reads as 'connected'. But 'completed' means
-- the call attempt finished, not that a person answered it. Faithful to the
-- word GoHighLevel uses, and wrong about the thing it describes.
--
-- WHAT THIS DOES NOT DO
--
-- It does not change connected_outbound, and it does not change the Pickup %
-- column on the fulfilment tracker. That tab is a column-for-column mirror of
-- Joshua's STATS DASHBOARD and nobody has confirmed which definition his sheet
-- uses, so quietly redefining a mirrored column would make the two disagree
-- without either of them being marked as changed.
--
-- It does not change mapOutcome either. That feeds the call-centre leaderboard
-- as well, and re-deciding what 'connected' means for everything that reads it
-- is a bigger change than this one, needing somebody to agree the definition.
--
-- What it adds is a counter with an unambiguous meaning: an outbound call that
-- had talk time. Appended, so existing readers are untouched.

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
    coalesce(
      sum(c.speed_to_lead_minutes) filter (
        where c.speed_to_lead_minutes >= 0 and c.speed_to_lead_minutes <= 1440
      ),
      0
    ) as speed_to_lead_min_sum,
    count(*) filter (
      where c.speed_to_lead_minutes >= 0 and c.speed_to_lead_minutes <= 1440
    ) as speed_to_lead_n,
    count(*) filter (where c.speed_to_lead_minutes > 1440) as speed_to_lead_over_24h,

    -- Appended below the existing columns, which is the only place CREATE OR
    -- REPLACE VIEW allows a new one.
    --
    -- Talk time, not a status word. One second is a pickup that went nowhere
    -- and zero seconds is not a pickup at all, so this is the weakest claim
    -- that is still true: somebody was on the line.
    count(*) filter (
      where c.direction::text = 'outbound' and coalesce(c.duration_seconds, 0) > 0
    ) as answered_outbound,

    -- Kept alongside it so the gap between the two is visible in the data
    -- rather than only in this comment. If this ever falls to zero, the
    -- upstream status mapping has been fixed and the two definitions agree.
    count(*) filter (
      where c.direction::text = 'outbound'
        and c.outcome::text = 'connected'
        and coalesce(c.duration_seconds, 0) = 0
    ) as connected_but_silent
  from calls c
  join clients cl on cl.id = c.client_id
  where c.started_at is not null
  group by c.client_id, cl.name, cl.group_id, (c.started_at::date);

-- security_invoker was set when the view was created and CREATE OR REPLACE
-- keeps reloptions, but it is restated so a future replace cannot drop it
-- silently and hand every reader the view owner's rights.
alter view public.v_cft_call_daily set (security_invoker = on);

comment on view public.v_cft_call_daily is
  'Calls per client per day, for the Client Fulfilment Tracker. '
  'connected_outbound counts GoHighLevel''s own status word and overstates '
  'pickups badly — it treats a finished call attempt as an answered one, and '
  '1,299 of 2,233 such calls in the 30 days to 2026-09-07 had no talk time at '
  'all. Use answered_outbound for anything a person will act on; '
  'connected_but_silent is the difference between the two. Calls have no '
  'campaign grain: the calls table carries no campaign reference and deal_id '
  'is null on every row.';
