-- ===========================================================================
-- Charges that cannot be tied to an appointment.
--
-- appointment_exceptions looks outward from the ledger, so it can only see
-- problems that have a ledger row. A charge naming a patient who exists in
-- neither the calendar nor the tracker has no row to hang off, and was therefore
-- invisible to it — which is how 38 charge lines worth $9,808 sat unnoticed while
-- the same reconciliation reported unbilled work in the other direction.
--
-- This is the more serious direction. Unbilled work is revenue not yet taken; a
-- charge with no appointment behind it is revenue taken with no evidence, and it
-- is the one a client can dispute.
--
-- What the numbers were when this was written, so the next person can tell
-- whether it moved: 334 charge lines, 292 paired to an attempt, 38 orphaned.
-- Of the 38, all fell inside the window both feeds cover, 5 had a surname
-- matching somebody else at the same practice, 3 existed under a different
-- practice, and 30 worth $8,442 appeared nowhere at all.
--
-- Two things this view is careful about.
--
-- Every line is bounded to the window the tracker covers, so a charge older than
-- the tracker's first row is history rather than an orphan.
--
-- A surname matching somebody else at the same practice is flagged separately at
-- lower severity. A spelling difference between Stripe and the sheet looks
-- identical to a phantom charge and has a completely different fix, and calling
-- one the other would be the same class of mistake this whole reconciliation
-- exists to catch.
-- ===========================================================================
create or replace view charge_exceptions as
with coverage as (
  select min(booked_for) as tracker_from from tracker_appointments
),
charge_line as (
  select b.stripe_payment_intent_id, b.client_id, b.occurred_at, b.amount_cents,
         greatest(coalesce(b.consult_count, 1), 1) as lines,
         btrim(n) as patient_name,
         lower(btrim(n)) as patient,
         row_number() over (
           partition by b.client_id, lower(btrim(n))
           order by b.occurred_at, b.stripe_payment_intent_id
         ) as line_no
  from billing_charges b, unnest(coalesce(b.consult_names, array[]::text[])) as n
  where b.outcome = 'succeeded' and b.client_id is not null and btrim(n) <> ''
),
attempts as (
  select client_id, lower(btrim(patient_name)) as p, count(*) as rows_for_patient
  from appointment_ledger
  where patient_name is not null
  group by 1, 2
),
flagged as (
  select
    cl.stripe_payment_intent_id,
    cl.client_id,
    cl.patient_name,
    cl.occurred_at,
    -- An allocation, same as the ledger's: Stripe was never told which line on a
    -- multi-consultation charge was worth what.
    round(cl.amount_cents::numeric / cl.lines)::bigint as line_amount_cents,
    case
      when a.p is null
        and exists (
          select 1 from appointment_ledger l
          where l.client_id = cl.client_id and l.patient_name is not null
            and split_part(lower(btrim(l.patient_name)), ' ', -1)
              = split_part(cl.patient, ' ', -1)
        )
        then 'name may be spelled differently in the tracker'
      when a.p is null
        then 'charged with no appointment record anywhere'
      when cl.line_no > a.rows_for_patient
        then 'charged more times than there are appointments'
    end as exception
  from charge_line cl
  left join attempts a on a.client_id = cl.client_id and a.p = cl.patient
  cross join coverage cv
  where cl.occurred_at::date >= cv.tracker_from
)
select f.stripe_payment_intent_id, f.client_id, c.name as practice,
       f.patient_name, f.occurred_at, f.line_amount_cents, f.exception,
       case
         when f.exception = 'charged with no appointment record anywhere' then 1
         when f.exception = 'charged more times than there are appointments' then 1
         else 3
       end as severity
from flagged f
join clients c on c.id = f.client_id
where f.exception is not null;

comment on view charge_exceptions is
  'Charges that cannot be tied to an appointment. appointment_exceptions can only see problems that have a ledger row, so a charge naming a patient who exists in neither feed was invisible to it. This is the more serious direction: unbilled work is revenue not yet taken, a charge with no appointment behind it is revenue taken with no evidence. Bounded to the window both feeds cover, and a surname matching somebody else at the same practice is flagged as a possible spelling difference rather than a phantom.';
