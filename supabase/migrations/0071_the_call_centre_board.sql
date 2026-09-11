-- The team board the call centre currently reads off HotProspector.
--
-- Joshua asked for these stats updated daily as an automation. Nothing here is
-- scraped: every column is computed from raw_call_rows, the same per-call feed
-- the pay dashboard counts, so this board and agent pay cannot drift apart.
--
-- WHAT THE SCREENSHOT CONFIRMED, AND WHAT IT DID NOT
--
-- Three rates reconcile exactly against a live board for one day:
--
--   answers 433 / outbound 959 = 45.2%   board showed AR  45%
--   convos   43 / answers  433 =  9.93%  board showed CR   9.93%
--   appts     9 / convos    43 = 20.93%  board showed ABR 20.93%
--
-- So AR is of outbound, CR is of answers, ABR is of conversations. Those
-- denominators are the thing most easily got wrong, and they are settled.
--
-- But confirming a FORMULA is not the same as knowing how to derive its INPUT,
-- and I ran those two together in the first cut. "Answers" is a HotProspector
-- concept and nothing in our feed obviously reproduces it. Over the last 30
-- days of outbound calls:
--
--   status = 'completed'                     91.0%
--   duration > 0                             96.4%
--   duration >= 10s                          89.7%
--   duration >= 20s                          72.8%
--   duration >= 30s                          60.0%
--   disposition set and not 'No Answer'      18.7%
--
-- The board showed 45%. Nothing lands there, and picking the nearest would be
-- fitting a number to a screenshot rather than understanding it.
--
-- So this view carries every candidate side by side instead of choosing. The
-- feed is live again, so the moment we hold one day that HotProspector also
-- shows, a single query settles it and the choice becomes a line of SQL rather
-- than a rebuild.
--
-- SOLID TODAY, because none of it depends on "answers":
--   OUTBOUND, INBOUND, HANG UPS, TALK MIN, AVG MIN, AOD, AID, CONVOS, APPTS,
--   and ABR (appointments over conversations).
--
-- BLOCKED until answers is settled: ANSWERS, AR, CR.
--
-- BLOCKED on another source entirely:
--   ANS/HR    needs hours worked; Hubstaff has them and payout-hours waits on
--             HUBSTAFF_TOKEN. Arrives free the day that is set.
--   SMS       nothing in the call feed carries messages.
--   PROSPECTS nothing in the call feed carries a prospect count.
-- Show these as unavailable rather than dropping them. A board that looks
-- complete and is not is worse than one that admits a gap.
--
-- COUNTERS ONLY. Every rate is left to the caller to compute from summed
-- counters, because averaging a ratio across days gives the wrong answer
-- whenever the days differ in volume — the same rule the rest of this codebase
-- follows.
--
-- Two agents on Joshua's board, Javier Quinonez and Max Sibiya, had no rows in
-- raw_call_rows at all. They were added to call_agents so their calls attribute
-- on arrival rather than landing unrostered. If rows never appear for them, the
-- explanation is not "new hire" and is worth chasing.

drop view if exists v_call_centre_agent_daily;

create view v_call_centre_agent_daily
with (security_invoker = on) as
  select
    g.id                                   as agent_id,
    g.display_name,
    r.called_on                            as day,

    count(*)                                                as calls,
    count(*) filter (where r.direction ilike '%out%')        as outbound,
    count(*) filter (where r.direction ilike '%in%')         as inbound,
    count(*) filter (where r.disposition ilike '%hang up%')  as hang_ups,

    /*
     * Five candidate definitions of "answered", outbound only, to be compared
     * against a same-day HotProspector board. Exactly one of these is what
     * HotProspector means; none is yet known to be.
     */
    count(*) filter (where r.direction ilike '%out%'
                       and r.status = 'completed')           as ans_status_completed,
    count(*) filter (where r.direction ilike '%out%'
                       and coalesce(r.duration_seconds,0) > 0)  as ans_any_duration,
    count(*) filter (where r.direction ilike '%out%'
                       and coalesce(r.duration_seconds,0) >= 20) as ans_20s,
    count(*) filter (where r.direction ilike '%out%'
                       and coalesce(r.duration_seconds,0) >= 30) as ans_30s,
    count(*) filter (where r.direction ilike '%out%'
                       and r.disposition is not null
                       and r.disposition not ilike '%no answer%') as ans_dispositioned,

    /*
     * A conversation is 90 seconds or more. Inherited from the pay dashboard's
     * own "90+ Second Convos" column, and still unverified — our feed ended on
     * 9 September and the board showed that day, so there was nothing to
     * compare. If the counts come out wrong, this is the first thing to change.
     */
    count(*) filter (where coalesce(r.duration_seconds, 0) >= 90) as convos,

    count(*) filter (where r.disposition ilike '%booked%')   as appts,

    sum(coalesce(r.duration_seconds, 0))                     as talk_seconds,
    sum(coalesce(r.duration_seconds, 0))
      filter (where r.direction ilike '%out%')               as outbound_seconds,
    count(*) filter (where r.direction ilike '%out%'
                       and coalesce(r.duration_seconds,0) > 0) as outbound_timed,
    sum(coalesce(r.duration_seconds, 0))
      filter (where r.direction ilike '%in%')                as inbound_seconds,
    count(*) filter (where r.direction ilike '%in%'
                       and coalesce(r.duration_seconds,0) > 0) as inbound_timed
  from call_agents g
  join raw_call_rows r on r.agent_id = g.id
  where r.called_on is not null
  group by g.id, g.display_name, r.called_on;

comment on view v_call_centre_agent_daily is
  'Per agent per day: the counters behind the HotProspector team board, computed '
  'from raw_call_rows rather than scraped, so this and agent pay cannot drift '
  'apart. Counters only — rates are computed from summed counters by the caller, '
  'never averaged across days. "Answers" is deliberately NOT decided: five '
  'candidate definitions are carried side by side because none reproduces '
  'HotProspector''s figure, and choosing the closest would be fitting to a '
  'screenshot. Settle it against one day where both boards exist, then collapse '
  'to the winner. ANS/HR, SMS and PROSPECTS need sources the call feed does not '
  'carry.';
