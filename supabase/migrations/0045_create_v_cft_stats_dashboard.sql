-- v_cft_stats_dashboard — campaign grain, one row per (client, campaign, day).
--
-- BACKFILL, for the same reason as 0044: live since 4 September 2026, applied
-- straight to the database, defined by no file here. This is the view the
-- Client Fulfilment Tracker tab reads for everything except its call columns,
-- so a database built from these migrations without it produced a dashboard
-- that could not load at all.
--
-- Recovered with pg_get_viewdef and verified against production row for row
-- before being committed. Its long COMMENT ON VIEW is the contract for reading
-- it — additive columns, ratios computed after aggregation, and the list of
-- what is knowingly absent. Read it before using any column here.

create or replace view public.v_cft_stats_dashboard as
  with ins as (
    select
      i.client_id,
      cmp.external_id as campaign_external_id,
      i.insight_on    as day,
      sum(i.spend_cents) as spend_cents,
      sum(i.impressions) as impressions,
      sum(i.clicks)      as clicks,
      sum(i.leads)       as leads_windsor
    from ad_level_insights i
      join campaigns cmp on cmp.id = i.campaign_id
    where i.client_id is not null
    group by i.client_id, cmp.external_id, i.insight_on
  ),
  lds as (
    select
      client_id,
      campaign_external_id,
      received_on as day,
      sum(coalesce(lead_count, 1)) as leads_tracker
    from tracker_leads
    where client_id is not null
    group by client_id, campaign_external_id, received_on
  ),
  /*
   * Appointments from both feeds, unioned before counting.
   *
   * The tracker branch keys on coalesce(created_on, booked_for): created_on is
   * null on 1,108 of 1,281 tracker rows and a null day matches nothing, so
   * those appointments used to contribute nothing at all. See 0042.
   *
   * The second branch is the CRM-only appointments — consultations booked after
   * the sheet was last imported, which exist nowhere else. They carry no
   * campaign and supply created, shows, no-shows and cancels only: DQ, Closed
   * and Follow up are the sheet's own vocabulary and ledger_outcome has no
   * equivalent, so zero on those columns is honest where a mapping would be
   * invented.
   */
  appt_src as (
    select
      t.client_id,
      t.campaign_external_id,
      coalesce(t.created_on, t.booked_for) as day,
      t.booked_for,
      t.appointment_status is null      as is_pending,
      t.appointment_status = 'Showed'   as is_show,
      t.appointment_status = 'No Show'  as is_no_show,
      t.status_if_showed = 'DQ'         as is_dq,
      t.status_if_showed = 'Closed'     as is_close,
      t.status_if_showed = 'Follow up'  as is_follow_up,
      l.cancelled_at is not null        as is_cancel,
      l.id is null                      as not_in_ledger
    from tracker_appointments t
      left join appointment_ledger l
        on l.client_id = t.client_id
       and l.tracker_source_row = t.source_row
    where t.client_id is not null
    union all
    select
      l.client_id,
      null::text                                        as campaign_external_id,
      (l.appointment_at at time zone 'UTC')::date       as day,
      (l.appointment_at at time zone 'UTC')::date       as booked_for,
      l.outcome = 'pending'::ledger_outcome             as is_pending,
      l.outcome = 'showed'::ledger_outcome              as is_show,
      l.outcome = 'no_show'::ledger_outcome             as is_no_show,
      false                                             as is_dq,
      false                                             as is_close,
      false                                             as is_follow_up,
      l.cancelled_at is not null                        as is_cancel,
      false                                             as not_in_ledger
    from appointment_ledger l
    where l.client_id is not null
      and l.tracker_source_row is null
      and l.appointment_at is not null
  ),
  appt as (
    select
      client_id,
      campaign_external_id,
      day,
      count(*) as appts_created,
      count(*) filter (where is_pending) as appts_pending,
      max(booked_for) as last_appt_date,
      count(*) filter (where is_show)       as shows,
      count(*) filter (where is_no_show)    as no_shows,
      count(*) filter (where is_dq)         as dqs,
      count(*) filter (where is_close)      as closes,
      count(*) filter (where is_follow_up)  as follow_ups,
      count(*) filter (where is_cancel)     as cancels,
      count(*) filter (where not_in_ledger) as appts_not_in_ledger
    from appt_src
    group by client_id, campaign_external_id, day
  ),
  -- The most common offer for the campaign, not per day: the sheet shows one
  -- offer name per campaign row and mode() is the honest reading of a column
  -- typed by hand.
  ofr as (
    select
      client_id,
      campaign_external_id,
      mode() within group (order by offer_name) as offer_name
    from tracker_appointments
    where client_id is not null
      and offer_name is not null
    group by client_id, campaign_external_id
  ),
  spine as (
    select client_id, campaign_external_id, day from ins
    union select client_id, campaign_external_id, day from lds
    union select client_id, campaign_external_id, day from appt
  )
  select
    -- Column A in the sheet, typed by hand there. No Hub store exists.
    null::text as notes,
    case when cl.is_active then 'Active' else 'Paused' end as status,
    cl.name  as client_name,
    cmp.name as campaign_name,
    s.campaign_external_id as campaign_id_external,
    o.offer_name,
    s.client_id,
    cl.group_id,
    cl.is_active,
    cmp.id     as campaign_uuid,
    cmp.status as campaign_status,
    s.day,
    coalesce(i.spend_cents, 0::bigint)   as spend_cents,
    coalesce(i.impressions, 0::bigint)   as impressions,
    coalesce(i.clicks, 0::bigint)        as clicks,
    coalesce(i.leads_windsor, 0::bigint) as leads_windsor,
    coalesce(l.leads_tracker, 0::bigint) as leads_tracker,
    -- greatest(), not a sum: Meta reports no leads for 30 of 35 accounts, so
    -- adding the two feeds would double-count wherever both have figures.
    greatest(
      coalesce(i.leads_windsor, 0::bigint),
      coalesce(l.leads_tracker, 0::bigint)
    ) as leads_best,
    coalesce(a.appts_created, 0::bigint) as appts_created,
    coalesce(a.appts_pending, 0::bigint) as appts_to_be_taken,
    a.last_appt_date,
    coalesce(a.shows, 0::bigint)               as shows,
    coalesce(a.no_shows, 0::bigint)            as no_shows,
    coalesce(a.cancels, 0::bigint)             as cancels,
    coalesce(a.dqs, 0::bigint)                 as dqs,
    coalesce(a.follow_ups, 0::bigint)          as follow_ups,
    coalesce(a.appts_not_in_ledger, 0::bigint) as appts_not_in_ledger,
    coalesce(a.closes, 0::bigint)              as closes,
    -- Column AC. billing_charges is AGENCY revenue, a different quantity, so
    -- it is deliberately not substituted here. ROI (AD) is null for the same
    -- reason.
    null::bigint as revenue_cents
  from spine s
    join clients cl on cl.id = s.client_id
    /*
     * "not distinct from", not "=", on every campaign join.
     *
     * campaign_external_id is null for 118 tracker rows and for every CRM-only
     * appointment, and null = null is null, so a plain equality would drop
     * exactly the rows that have no campaign — the ones the blank-campaign row
     * exists to hold.
     */
    left join campaigns cmp
      on cmp.client_id = s.client_id
     and not cmp.external_id is distinct from s.campaign_external_id
    left join ins i
      on i.client_id = s.client_id
     and not i.campaign_external_id is distinct from s.campaign_external_id
     and i.day = s.day
    left join lds l
      on l.client_id = s.client_id
     and not l.campaign_external_id is distinct from s.campaign_external_id
     and l.day = s.day
    left join appt a
      on a.client_id = s.client_id
     and not a.campaign_external_id is distinct from s.campaign_external_id
     and a.day = s.day
    left join ofr o
      on o.client_id = s.client_id
     and not o.campaign_external_id is distinct from s.campaign_external_id;

alter view public.v_cft_stats_dashboard set (security_invoker = on);

comment on view public.v_cft_stats_dashboard is
'Campaign-grain, one row per (client, campaign, day). Mirrors the STATS DASHBOARD tab of the
Client Fulfilment Tracker (spreadsheet 1MmpXLANeiffDrT9zIaNcLY8ekk_CZ1-96wYer1XTtiE), whose
header row is row 5 and whose section headers are row 4.

CONTRACT: every numeric column is ADDITIVE. Aggregate over the window first, then compute
ratios from the sums. Never average a ratio; doing so is wrong whenever the day rows differ
in volume.

Derived after aggregation:
  I  CPL              = spend_cents/100.0 / nullif(leads_best,0)
  S  Schedule %       = appts_created / nullif(leads_best,0)
  X  DQ %             = dqs / nullif(appts_created,0)
  Y  Cancel %         = cancels / nullif(appts_created,0)
  Z  Show %           = shows / nullif(appts_created,0)
  AB Close %          = closes / nullif(shows,0)
  AE Cost Per Booking = spend_cents/100.0 / nullif(appts_created,0)
  AF Cost Per Show    = spend_cents/100.0 / nullif(shows,0)
  AG Cost Per Close   = spend_cents/100.0 / nullif(closes,0)

SECTION 2 (CALL DATA, columns J-O) IS NOT HERE. The calls table carries no campaign reference
and calls.deal_id is null on all rows, so call activity cannot be attributed to a campaign.
Those columns come from v_cft_call_daily, which is client-grain. In a campaign breakdown they
must render blank, never the client total repeated on every campaign row.

THE APPOINTMENT DAY, and why it is a fallback (migration 0042):
appointments are keyed on created_on where it exists and booked_for where it does not.
created_on is null on 1,108 of 1,281 tracker rows, and a null day matches nothing, so those
appointments used to contribute nothing at all -- appts_created for a 30-day window read 95
when the true figure was 185. Near a window edge a booking can now shift by the gap between
booking and consultation; that is a far smaller error than dropping six sevenths of the rows.

CRM-ONLY APPOINTMENTS (migration 0042):
the tracker sheet has not been re-imported since 22 August 2026, so consultations booked after
that exist only in the CRM. They are included from appointment_ledger where no tracker row
matched, carry NO campaign, and land on the blank-campaign row alongside the 118 tracker rows
that have no campaign id. They supply created, shows, no-shows and cancels only: DQ, Closed and
Follow up are the sheet''s own vocabulary, written by hand into status_if_showed, and
ledger_outcome has no equivalent (pending, showed, no_show, cancelled, rescheduled). Zero on
those columns for a CRM row is honest; a mapping would be invented.

Known limits, as of 2026-09-05:
  * notes (A) is typed by hand in the sheet. No Hub store exists; always null.
  * revenue_cents (AC) has no Hub source. billing_charges is AGENCY revenue, a different
    quantity, so it is deliberately not substituted. ROI (AD) is therefore null.
  * leads_windsor is 0 for 30 of 35 ad accounts. This is NOT a Windsor field fault:
    actions_lead equals the pixel field where pixel leads exist and the on-Facebook field where
    those exist. Meta itself reports no leads for those accounts, so the conversion events are
    not reaching Meta. leads_best takes greatest(windsor, tracker) as the workaround.
  * 15 Windsor ad accounts are mapped to no client, including one with 119 leads in a 30-day
    window. Their spend and leads cannot enter the Hub until somebody maps them.
  * spend was double-counted until 2026-09-05: windsor-ads summed duplicate ad-day rows from
    the API. Fixed at the sync, but only the days each run rewrites are corrected -- widen
    WINDSOR_WINDOW_DAYS for a one-off backfill of older days.
  * cancels come from appointment_ledger.cancelled_at; tracker rows join on
    (client_id, tracker_source_row), CRM-only rows carry their own.
  * days are calendar dates in the stored timezone, so a window boundary can move a row by one
    day.';
