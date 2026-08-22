-- ===========================================================================
-- Fill the ledger from both feeds.
--
-- Idempotent and re-runnable: identity comes from the feeds' own keys, so a
-- second run updates rather than forking. Proven on the live data -- two
-- consecutive runs both land on 1,304 rows and the second bills nothing.
--
-- The matching rule is practice + patient + date, the same rule that found 65
-- tracker-only and 10 calendar-only consultations. Where both feeds hold the
-- same appointment it becomes one row carrying both ids, which is leak 8 closed
-- rather than described.
--
-- Where the feeds disagree about the outcome the tracker wins. It is the human
-- record and the only one carrying a close; the calendar knows attendance and
-- nothing about what happened next. Neither feed is the Post Appointment Survey,
-- so outcome_source reads 'tracker' or 'crm' and never 'survey' -- the survey
-- has not been filled in once, which is leak 1 in a single fact.
-- ===========================================================================
create or replace function rebuild_appointment_ledger()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_from_crm     integer;
  v_from_tracker integer;
  v_matched      integer;
  v_chains       integer;
  v_billed       integer;
begin
  -- ---- 1. the calendar feed ---------------------------------------------
  insert into appointment_ledger (
    client_id, crm_appointment_id, patient_name, patient_email, patient_phone,
    booked_at, booked_by_name, appointment_at, calendar_seen_at,
    outcome, outcome_source, outcome_at, outcome_due_at,
    cancelled_at, last_seen_in_crm_at, seen_in, source
  )
  select
    a.client_id, a.crm_appointment_id, a.patient_name, a.patient_email, a.patient_phone,
    a.booked_at, a.booked_by_name, a.scheduled_at, coalesce(a.synced_at, a.updated_at),
    case
      when a.status = 'cancelled' then 'cancelled'::ledger_outcome
      when a.showed is true then 'showed'::ledger_outcome
      when a.showed is false then 'no_show'::ledger_outcome
      else 'pending'::ledger_outcome
    end,
    case when a.showed is not null or a.status = 'cancelled'
         then 'crm'::ledger_outcome_source end,
    case when a.showed is not null then coalesce(a.outcome_updated_at, a.synced_at) end,
    -- Leak 6's timer. Two days is long enough for a practice to answer and short
    -- enough that a skipped ritual surfaces while anybody still remembers the
    -- patient.
    a.scheduled_at + interval '48 hours',
    case when a.status = 'cancelled' then coalesce(a.cancelled_at, a.updated_at) end,
    coalesce(a.synced_at, a.updated_at),
    jsonb_build_object('crm', coalesce(a.synced_at, a.updated_at)),
    'unknown'::ledger_source
  from appointments a
  where a.crm_appointment_id is not null
  on conflict (crm_appointment_id) where crm_appointment_id is not null
  do update set
    appointment_at      = excluded.appointment_at,
    calendar_seen_at    = excluded.calendar_seen_at,
    last_seen_in_crm_at = excluded.last_seen_in_crm_at,
    seen_in             = appointment_ledger.seen_in || excluded.seen_in,
    -- Never downgrade a resolved outcome back to pending on a re-run.
    outcome        = case when excluded.outcome = 'pending'
                          then appointment_ledger.outcome else excluded.outcome end,
    outcome_source = coalesce(excluded.outcome_source, appointment_ledger.outcome_source),
    outcome_at     = coalesce(excluded.outcome_at, appointment_ledger.outcome_at),
    outcome_due_at = excluded.outcome_due_at,
    cancelled_at   = coalesce(excluded.cancelled_at, appointment_ledger.cancelled_at),
    updated_at     = now();

  select count(*) into v_from_crm from appointment_ledger where crm_appointment_id is not null;

  -- ---- 2. the tracker feed ---------------------------------------------
  with trk as (
    select
      t.id, t.client_id, t.source_row, 'Appointment Data' as tab,
      t.patient_name, t.patient_email, t.created_on, t.booked_for,
      t.appointment_status, t.status_if_showed,
      case
        when t.appointment_status ilike '%no show%' then 'no_show'::ledger_outcome
        when t.appointment_status ilike '%cancel%' then 'cancelled'::ledger_outcome
        when t.appointment_status ilike '%show%' then 'showed'::ledger_outcome
        else 'pending'::ledger_outcome
      end as outcome
    from tracker_appointments t
    where t.client_id is not null
  ),
  paired as (
    select trk.*, l.id as ledger_id
    from trk
    left join appointment_ledger l
      on l.client_id = trk.client_id
     and lower(btrim(l.patient_name)) = lower(btrim(trk.patient_name))
     and (l.appointment_at at time zone 'UTC')::date = trk.booked_for
     and l.crm_appointment_id is not null
  ),
  merged as (
    update appointment_ledger l
    set tracker_source_tab = p.tab,
        tracker_source_row = p.source_row,
        dispositioned_at   = coalesce(l.dispositioned_at, p.created_on::timestamptz),
        seen_in            = l.seen_in || jsonb_build_object('tracker', now()),
        -- The tracker wins: it is the only feed that records a close.
        outcome            = case when p.outcome = 'pending' then l.outcome else p.outcome end,
        outcome_source     = case when p.outcome = 'pending' then l.outcome_source
                                  else 'tracker'::ledger_outcome_source end,
        raw_disposition    = coalesce(p.appointment_status, l.raw_disposition),
        updated_at         = now()
    from paired p
    where l.id = p.ledger_id and p.ledger_id is not null
    returning l.id
  )
  select count(*) into v_matched from merged;

  -- Tracker rows with no calendar row anywhere.
  insert into appointment_ledger (
    client_id, tracker_source_tab, tracker_source_row,
    patient_name, patient_email, appointment_at, dispositioned_at,
    outcome, outcome_source, outcome_at, outcome_due_at, cancelled_at,
    raw_disposition, seen_in, source
  )
  select
    t.client_id, 'Appointment Data', t.source_row,
    t.patient_name, t.patient_email,
    t.booked_for::timestamptz, t.created_on::timestamptz,
    case
      when t.appointment_status ilike '%no show%' then 'no_show'::ledger_outcome
      when t.appointment_status ilike '%cancel%' then 'cancelled'::ledger_outcome
      when t.appointment_status ilike '%show%' then 'showed'::ledger_outcome
      else 'pending'::ledger_outcome
    end,
    case when coalesce(btrim(t.appointment_status), '') <> ''
         then 'tracker'::ledger_outcome_source end,
    case when coalesce(btrim(t.appointment_status), '') <> ''
         then t.booked_for::timestamptz end,
    case when t.booked_for is not null then t.booked_for::timestamptz + interval '48 hours' end,
    case when t.appointment_status ilike '%cancel%'
         then coalesce(t.booked_for, t.created_on)::timestamptz end,
    t.appointment_status,
    jsonb_build_object('tracker', now()),
    'unknown'::ledger_source
  from tracker_appointments t
  where t.client_id is not null
    and not exists (
      select 1 from appointment_ledger l
      where l.tracker_source_tab = 'Appointment Data'
        and l.tracker_source_row = t.source_row
    )
  on conflict (tracker_source_tab, tracker_source_row) where tracker_source_row is not null
  do nothing;

  select count(*) into v_from_tracker
  from appointment_ledger where tracker_source_row is not null;

  -- ---- 3. reschedule chains: leak 11 ------------------------------------
  -- Same practice, same patient, inside 45 days is one appointment moved.
  -- Outcomes are left exactly as recorded: a no-show that was later rebooked did
  -- happen, and erasing it would be its own falsehood. The chain is what lets a
  -- count of consultations count chains instead of rows.
  with ordered as (
    select id, client_id, lower(btrim(patient_name)) as p, appointment_at,
           lag(id) over w as prev_id,
           lag(appointment_at) over w as prev_at,
           row_number() over w as seq
    from appointment_ledger
    where patient_name is not null and appointment_at is not null
    window w as (
      partition by client_id, lower(btrim(patient_name))
      order by appointment_at
    )
  ),
  chained as (
    update appointment_ledger l
    set reschedule_of  = o.prev_id,
        attempt_number = o.seq,
        updated_at     = now()
    from ordered o
    where l.id = o.id
      and o.prev_id is not null
      and o.appointment_at - o.prev_at <= interval '45 days'
    returning l.id
  )
  select count(*) into v_chains from chained;

  -- ---- 4. money: leak 12 -------------------------------------------------
  -- A charge names the consultations it covers, so the ledger row can point at
  -- the charge that paid for it. The amount is the charge divided by the number
  -- of consultations on it -- an allocation rather than a fact, because Stripe
  -- was never told which line was worth what.
  with charge_line as (
    select b.stripe_payment_intent_id, b.client_id, b.occurred_at, b.amount_cents,
           greatest(coalesce(b.consult_count, 1), 1) as lines,
           lower(btrim(n)) as patient
    from billing_charges b, unnest(coalesce(b.consult_names, array[]::text[])) as n
    where b.outcome = 'succeeded' and b.client_id is not null and btrim(n) <> ''
  ),
  paid as (
    update appointment_ledger l
    set billing_state            = 'billed',
        billed_at                = cl.occurred_at,
        stripe_payment_intent_id = cl.stripe_payment_intent_id,
        amount_cents             = round(cl.amount_cents::numeric / cl.lines),
        updated_at               = now()
    from charge_line cl
    where l.client_id = cl.client_id
      and lower(btrim(l.patient_name)) = cl.patient
      and l.billing_state <> 'billed'
    returning l.id
  )
  select count(*) into v_billed from paid;

  -- Delivered and not paid for is the state Phase 6 exists to drive to zero.
  update appointment_ledger
  set billing_state = 'billable', updated_at = now()
  where outcome = 'showed' and billing_state = 'pending';

  return jsonb_build_object(
    'rows_total',       (select count(*) from appointment_ledger),
    'from_crm',         v_from_crm,
    'from_tracker',     v_from_tracker,
    'matched_both',     v_matched,
    'reschedule_links', v_chains,
    'billed_rows',      v_billed
  );
end;
$fn$;

revoke all on function rebuild_appointment_ledger() from public;
grant execute on function rebuild_appointment_ledger() to service_role;

-- ===========================================================================
-- The reconciliation rules only mean anything where both feeds have coverage.
--
-- The first cut of this view flagged 868 rows as "in the tracker only" -- every
-- consultation from before the calendar feed existed, forever -- and fired
-- "disposition not recognised" on all 134 rows carrying a status, because source
-- is 'unknown' for everything until the tracker gains a Source column. That is a
-- fact about a missing spreadsheet column, not a fault on an appointment.
--
-- An exception report is only worth reading if every line is actionable. Both
-- rules are now bounded by what they can actually detect: 1,231 rows became 696,
-- and the difference was entirely noise.
-- ===========================================================================
create or replace view appointment_exceptions as
with bounds as (
  -- The calendar feed cannot be missing an appointment from before it started.
  select min(appointment_at) as crm_from
  from appointment_ledger where crm_appointment_id is not null
),
flagged as (
  select
    l.*,
    case
      when l.billing_state = 'billed' and l.outcome <> 'showed'
        then 'billed without a recorded show'
      when l.missing_since is not null and l.outcome = 'pending'
        then 'vanished from the CRM while still open'
      when l.outcome = 'pending' and l.outcome_due_at < now()
        then 'outcome overdue'
      when l.dispositioned_at is not null and l.calendar_seen_at is null
           and l.appointment_at >= b.crm_from
        then 'dispositioned but never on a calendar'
      when not (l.seen_in ? 'crm') and not (l.seen_in ? 'hp')
           and l.appointment_at >= b.crm_from
        then 'in the tracker only'
      when not (l.seen_in ? 'tracker') and l.appointment_at < now()
        then 'happened but never written to the tracker'
      when l.outcome = 'showed' and l.client_calendar_state in ('manual', 'one_way', 'unknown')
           and l.client_calendar_checked_at is null
        then 'never verified against the practice calendar'
      when l.outcome = 'showed' and l.billing_state = 'billable'
        then 'delivered, not yet billed'
      when l.billing_state = 'on_hold' and coalesce(btrim(l.billing_hold_reason), '') = ''
        then 'on hold with no reason given'
      -- Leak 9 properly: a disposition was written and it did not resolve to an
      -- outcome. That is a string nobody mapped, which is the documented bug.
      when l.raw_disposition is not null and l.outcome = 'pending'
        then 'disposition did not map to an outcome'
    end as exception,
    case
      when l.billing_state = 'billed' and l.outcome <> 'showed' then 1
      when l.missing_since is not null and l.outcome = 'pending' then 2
      when l.outcome = 'pending' and l.outcome_due_at < now() then 3
      when l.dispositioned_at is not null and l.calendar_seen_at is null
           and l.appointment_at >= b.crm_from then 4
      else 5
    end as severity
  from appointment_ledger l cross join bounds b
)
select
  f.id, f.client_id, c.name as practice, f.patient_name, f.appointment_at,
  f.source, f.outcome, f.outcome_source, f.outcome_due_at,
  f.billing_state, f.amount_cents, f.exception, f.severity
from flagged f
join clients c on c.id = f.client_id
where f.exception is not null;

comment on view appointment_exceptions is
  'Every appointment in a state somebody has to act on, worst first: charged without evidence, vanished while open, outcome overdue, dispositioned with no calendar. The reconciliation rules are bounded by the window where both feeds have coverage -- the calendar cannot be missing an appointment from before it existed, and flagging 868 historical rows forever is how an exception report becomes something nobody reads.';
