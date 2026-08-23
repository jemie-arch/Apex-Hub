-- ===========================================================================
-- Attach a charge to the attempt that was actually delivered.
--
-- 0003 matched charges to ledger rows on patient name within a client. Every
-- attempt in a reschedule chain carries the same patient name, so UPDATE ... FROM
-- had several equally valid targets and Postgres picked one arbitrarily.
--
-- 17 of the 41 "billed without a recorded show" exceptions turned out to be
-- exactly that and nothing worse: the charge had landed on the no-show attempt
-- while the show sat unbilled two rows away. One misplacement reported both a
-- mischarge and an unbilled delivery. After this fix the count is 21, and those
-- 21 have no delivered attempt anywhere for that patient — which is a real
-- question rather than an artefact.
--
-- Attempts are now ranked, delivered first and then most recent, and the Nth
-- charge line for a patient pairs with the Nth-ranked attempt. A single charge
-- for a patient who no-showed and then showed goes to the show.
--
-- The step is also fully derived: it clears its own previous answer before
-- recomputing, so a re-run corrects an earlier misattribution rather than
-- preserving it. 'waived', 'disputed' and 'on_hold' are never touched, because
-- those are somebody's decision and not a derivation.
--
-- Split into its own function so there is exactly one implementation of the
-- rule. Two copies is how one of them ends up wrong, and this one was.
-- ===========================================================================
create or replace function attribute_ledger_charges()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare v_billed integer;
begin
  update appointment_ledger
  set billing_state = 'pending',
      billed_at = null,
      stripe_payment_intent_id = null,
      amount_cents = null,
      updated_at = now()
  where billing_state in ('billed', 'billable');

  with charge_line as (
    select b.stripe_payment_intent_id, b.client_id, b.occurred_at, b.amount_cents,
           greatest(coalesce(b.consult_count, 1), 1) as lines,
           lower(btrim(n)) as patient,
           row_number() over (
             partition by b.client_id, lower(btrim(n))
             order by b.occurred_at, b.stripe_payment_intent_id
           ) as line_no
    from billing_charges b, unnest(coalesce(b.consult_names, array[]::text[])) as n
    where b.outcome = 'succeeded' and b.client_id is not null and btrim(n) <> ''
  ),
  target as (
    select l.id, l.client_id, lower(btrim(l.patient_name)) as p,
           row_number() over (
             partition by l.client_id, lower(btrim(l.patient_name))
             order by (l.outcome = 'showed') desc,
                      l.appointment_at desc nulls last,
                      l.id
           ) as rank
    from appointment_ledger l
    where l.patient_name is not null
      and l.billing_state not in ('waived', 'disputed', 'on_hold')
  ),
  pairs as (
    select cl.stripe_payment_intent_id, cl.occurred_at, cl.amount_cents, cl.lines,
           t.id as ledger_id
    from charge_line cl
    join target t
      on t.client_id = cl.client_id and t.p = cl.patient and t.rank = cl.line_no
  ),
  paid as (
    update appointment_ledger l
    set billing_state            = 'billed',
        billed_at                = p.occurred_at,
        stripe_payment_intent_id = p.stripe_payment_intent_id,
        -- An allocation, not a fact: Stripe was never told which line on a
        -- multi-consultation charge was worth what.
        amount_cents             = round(p.amount_cents::numeric / p.lines),
        updated_at               = now()
    from pairs p
    where l.id = p.ledger_id
    returning l.id
  )
  select count(*) into v_billed from paid;

  update appointment_ledger
  set billing_state = 'billable', updated_at = now()
  where outcome = 'showed' and billing_state = 'pending';

  return v_billed;
end;
$fn$;

revoke all on function attribute_ledger_charges() from public;
grant execute on function attribute_ledger_charges() to service_role;

-- ===========================================================================
-- rebuild_appointment_ledger(), with step 4 delegating rather than duplicating.
--
-- Steps 1 to 3 are unchanged from 0003. Step 4 is now a call.
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
    -- Leak 6's timer: 48 hours is long enough for a practice to answer and short
    -- enough that a skipped no-show check surfaces while anyone still remembers.
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
  -- The tracker wins on outcome: it is the only feed carrying a close.
  with trk as (
    select
      t.client_id, t.source_row, 'Appointment Data' as tab,
      t.patient_name, t.patient_email, t.created_on, t.booked_for,
      t.appointment_status,
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
  -- Outcomes are left as recorded. A no-show later rebooked did happen, and
  -- erasing it would be its own falsehood; the chain is what lets a count of
  -- consultations count chains instead of rows.
  with ordered as (
    select id, client_id, appointment_at,
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

  -- ---- 4. money ---------------------------------------------------------
  -- Delegated, so there is exactly one implementation of the rule.
  v_billed := attribute_ledger_charges();

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
