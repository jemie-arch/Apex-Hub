-- v_cft_daily — the media-buyer view, one row per client per day.
--
-- BACKFILL. This view has been live since 4 September 2026 and was applied
-- straight to the database, so no file in this directory defined it. A rebuild
-- from these migrations produced a database without it, and without
-- v_cft_stats_dashboard in 0045 — while the dashboard reads both. The
-- definition below is the one running in production, recovered with
-- pg_get_viewdef and verified against it row for row before being committed.
--
-- Grants are Supabase's blanket defaults for anon, authenticated and
-- service_role, so there are none to restate. security_invoker is what makes
-- that safe: row-level security follows the caller, not the view owner.

create or replace view public.v_cft_daily as
  with ads as (
    select
      client_id,
      snapshot_on as day,
      sum(spend_cents)  as spend_cents,
      sum(impressions)  as impressions,
      sum(clicks)       as clicks,
      sum(leads)        as windsor_leads
    from ad_snapshots
    group by client_id, snapshot_on
  ),
  tl as (
    select
      client_id,
      received_on as day,
      sum(lead_count) as tracker_leads
    from tracker_leads
    group by client_id, received_on
  ),
  cl as (
    select
      client_id,
      (started_at at time zone 'UTC')::date as day,
      count(*) as calls_total,
      count(*) filter (where direction = 'inbound'::call_direction)  as calls_inbound,
      count(*) filter (where direction = 'outbound'::call_direction) as calls_outbound,
      count(*) filter (where outcome = 'connected'::call_outcome)    as calls_connected,
      count(*) filter (where outcome = 'booked'::call_outcome)       as calls_booked
    from calls
    group by client_id, ((started_at at time zone 'UTC')::date)
  ),
  ap as (
    select
      client_id,
      (booked_at at time zone 'UTC')::date as day,
      count(*) as appts_booked,
      count(*) filter (where outcome = 'showed'::ledger_outcome)  as appts_showed,
      count(*) filter (where outcome = 'no_show'::ledger_outcome) as appts_no_show,
      count(*) filter (where cancelled_at is not null)            as appts_cancelled,
      count(*) filter (where missing_since is not null)           as appts_missing,
      sum(amount_cents) filter (
        where billing_state = any (
          array['billable'::ledger_billing_state, 'billed'::ledger_billing_state]
        )
      ) as billable_cents
    from appointment_ledger
    group by client_id, ((booked_at at time zone 'UTC')::date)
  ),
  bc as (
    select
      client_id,
      (occurred_at at time zone 'UTC')::date as day,
      sum(amount_cents)  filter (where outcome = 'succeeded'::billing_outcome) as agency_revenue_cents,
      sum(consult_count) filter (where outcome = 'succeeded'::billing_outcome) as consults_billed
    from billing_charges
    group by client_id, ((occurred_at at time zone 'UTC')::date)
  ),
  -- A union of every (client, day) any feed has something to say about, so a
  -- day with calls but no spend is still a row.
  spine as (
    select client_id, day from ads
    union select client_id, day from tl
    union select client_id, day from cl
    union select client_id, day from ap
    union select client_id, day from bc
  )
  select
    s.client_id,
    c.name as client_name,
    c.group_id,
    c.is_active,
    c.ad_account_id,
    s.day,
    coalesce(a.spend_cents, 0::bigint)   as spend_cents,
    coalesce(a.impressions, 0::bigint)   as impressions,
    coalesce(a.clicks, 0::bigint)        as clicks,
    coalesce(a.windsor_leads, 0::bigint) as windsor_leads,
    coalesce(t.tracker_leads, 0::bigint) as tracker_leads,
    -- A per-day fallback, not a sum: Windsor reports zero for most accounts
    -- while the sheet has real counts. Remove it once Windsor is fixed.
    greatest(
      coalesce(a.windsor_leads, 0::bigint),
      coalesce(t.tracker_leads, 0::bigint)
    ) as leads_best_available,
    coalesce(k.calls_total, 0::bigint)     as calls_total,
    coalesce(k.calls_inbound, 0::bigint)   as calls_inbound,
    coalesce(k.calls_outbound, 0::bigint)  as calls_outbound,
    coalesce(k.calls_connected, 0::bigint) as calls_connected,
    coalesce(k.calls_booked, 0::bigint)    as calls_booked,
    coalesce(p.appts_booked, 0::bigint)    as appts_booked,
    coalesce(p.appts_showed, 0::bigint)    as appts_showed,
    coalesce(p.appts_no_show, 0::bigint)   as appts_no_show,
    coalesce(p.appts_cancelled, 0::bigint) as appts_cancelled,
    coalesce(p.appts_missing, 0::bigint)   as appts_missing,
    coalesce(p.billable_cents, 0::bigint)  as billable_cents,
    coalesce(b.agency_revenue_cents, 0::numeric) as agency_revenue_cents,
    coalesce(b.consults_billed, 0::bigint)       as consults_billed,
    case
      when coalesce(a.impressions, 0::bigint) > 0
        then round(coalesce(a.clicks, 0::bigint)::numeric / a.impressions::numeric, 6)
      else null::numeric
    end as ctr,
    case
      when coalesce(a.impressions, 0::bigint) > 0
        then round(
          coalesce(a.spend_cents, 0::bigint)::numeric / 100::numeric
            / (a.impressions::numeric / 1000::numeric), 2)
      else null::numeric
    end as cpm_usd,
    case
      when greatest(coalesce(a.windsor_leads, 0::bigint), coalesce(t.tracker_leads, 0::bigint)) > 0
        then round(
          coalesce(a.spend_cents, 0::bigint)::numeric / 100::numeric
            / greatest(
                coalesce(a.windsor_leads, 0::bigint),
                coalesce(t.tracker_leads, 0::bigint)
              )::numeric, 2)
      else null::numeric
    end as cost_per_lead_usd,
    case
      when coalesce(p.appts_booked, 0::bigint) > 0
        then round(
          coalesce(a.spend_cents, 0::bigint)::numeric / 100::numeric / p.appts_booked::numeric, 2)
      else null::numeric
    end as cost_per_booking_usd,
    case
      when coalesce(p.appts_showed, 0::bigint) > 0
        then round(
          coalesce(a.spend_cents, 0::bigint)::numeric / 100::numeric / p.appts_showed::numeric, 2)
      else null::numeric
    end as cost_per_show_usd,
    case
      when coalesce(a.spend_cents, 0::bigint) > 0
        then round(
          (coalesce(b.agency_revenue_cents, 0::numeric) - a.spend_cents::numeric)
            / a.spend_cents::numeric, 4)
      else null::numeric
    end as agency_roi
  from spine s
    join clients c on c.id = s.client_id
    left join ads a on a.client_id = s.client_id and a.day = s.day
    left join tl  t on t.client_id = s.client_id and t.day = s.day
    left join cl  k on k.client_id = s.client_id and k.day = s.day
    left join ap  p on p.client_id = s.client_id and p.day = s.day
    left join bc  b on b.client_id = s.client_id and b.day = s.day;

alter view public.v_cft_daily set (security_invoker = on);

comment on view public.v_cft_daily is
  'Consolidated Client Fulfillment Tracker, one row per client per day. Built for the media-buyer view: ads, calls, appointments, agency revenue and the derived cost metrics in one place. Grain is the day the activity happened, in UTC -- clients.timezone is NOT yet applied, so a late-evening booking in a US timezone may land on the following UTC day. security_invoker is on, so row-level security follows the caller rather than the view owner. leads_best_available is a per-day fallback (the greater of Windsor and the tracker sheet) not a sum, because Windsor returns zero for 30 of 32 accounts while the sheet has real counts -- remove it once Windsor is fixed. There is no "closes" column: appointment_ledger.outcome has no won/closed state, so closes must be defined before it can be reported. agency_revenue_cents is Stripe billing to the client, i.e. agency revenue per consult -- it is NOT patient treatment revenue, which is not held anywhere in this database.';
