-- ===========================================================================
-- A shared surname is not a spelling mistake.
--
-- 0005 downgraded a charge to severity 3 — "name may be spelled differently" —
-- whenever some other patient at the same practice shared its surname. That was
-- too loose, and reviewing the five rows it produced showed exactly how:
--
--   Christopher Blackwood  vs  Chrispher blackwood   real typo
--   Bhagarvi Patel         vs  Bhargavi Patel        real typo, transposed
--   Loudin Pierre          vs  Lou Pierre            nickname, same person
--   Breana Daniels         vs  Phil Daniels          DIFFERENT PERSON
--
-- The last one is the problem. Breana Daniels has no appointment anywhere, which
-- makes it a genuinely unevidenced charge — and the heuristic quietly filed it as
-- a spelling variant, below the alerting threshold. At a dental practice a shared
-- surname is more often a family member than a misspelling, so the rule was
-- wrong in the one direction that costs money: it hides a disputable charge.
--
-- Trigram similarity on the whole name does not separate these safely.
-- Bhagarvi/Bhargavi scores 0.500 and Breana/Phil scores 0.400 — too close to put
-- a threshold between. The first name does separate them cleanly: a genuine
-- misspelling or nickname keeps the first initial (Chrispher, Bhargavi, Lou),
-- while a different family member does not.
--
-- So the test is now: same surname AND (same first initial OR the first names
-- share trigrams). Anything else is treated as unevidenced.
--
-- Note which way this errs. A nickname that changes the initial — Bob for Robert
-- — will now be escalated to severity 1 rather than filed as a spelling variant.
-- That costs somebody a review. The opposite error costs a client dispute nobody
-- saw coming, so the asymmetry is deliberate.
--
-- Also adds candidate_name, so a reviewer can see who the row was matched
-- against instead of taking the classification on trust. Reviewing that column
-- is what found this bug.
-- ===========================================================================
-- Dropped rather than replaced: candidate_name is inserted mid-list, and
-- CREATE OR REPLACE VIEW can only append columns. Same transaction, so nothing
-- reading this view ever observes it missing.
drop view if exists charge_exceptions;

create view charge_exceptions as
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
/*
 * The best same-surname candidate for each charged name, with the first-name
 * test applied. Ranked so the closest first name wins, because a practice can
 * hold several people sharing a surname.
 */
candidate as (
  select distinct on (cl.stripe_payment_intent_id, cl.patient)
    cl.stripe_payment_intent_id,
    cl.patient,
    l.patient_name as candidate_name
  from charge_line cl
  join appointment_ledger l
    on l.client_id = cl.client_id
   and l.patient_name is not null
   and split_part(lower(btrim(l.patient_name)), ' ', -1)
     = split_part(cl.patient, ' ', -1)
   and (
         left(split_part(lower(btrim(l.patient_name)), ' ', 1), 1)
           = left(split_part(cl.patient, ' ', 1), 1)
         or similarity(
              split_part(lower(btrim(l.patient_name)), ' ', 1),
              split_part(cl.patient, ' ', 1)
            ) > 0.2
       )
  order by cl.stripe_payment_intent_id, cl.patient,
           similarity(lower(btrim(l.patient_name)), cl.patient) desc,
           l.patient_name
),
flagged as (
  select
    cl.stripe_payment_intent_id,
    cl.client_id,
    cl.patient_name,
    cd.candidate_name,
    cl.occurred_at,
    round(cl.amount_cents::numeric / cl.lines)::bigint as line_amount_cents,
    case
      when a.p is null and cd.candidate_name is not null
        then 'name may be spelled differently in the tracker'
      when a.p is null
        then 'charged with no appointment record anywhere'
      when cl.line_no > a.rows_for_patient
        then 'charged more times than there are appointments'
    end as exception
  from charge_line cl
  left join attempts a on a.client_id = cl.client_id and a.p = cl.patient
  left join candidate cd
    on cd.stripe_payment_intent_id = cl.stripe_payment_intent_id
   and cd.patient = cl.patient
  cross join coverage cv
  where cl.occurred_at::date >= cv.tracker_from
)
select f.stripe_payment_intent_id, f.client_id, c.name as practice,
       f.patient_name, f.candidate_name, f.occurred_at, f.line_amount_cents,
       f.exception,
       case
         when f.exception = 'charged with no appointment record anywhere' then 1
         when f.exception = 'charged more times than there are appointments' then 1
         else 3
       end as severity
from flagged f
join clients c on c.id = f.client_id
where f.exception is not null;

comment on view charge_exceptions is
  'Charges that cannot be tied to an appointment. A charge is only downgraded to a probable spelling difference when a same-surname patient also shares the first initial or first-name trigrams — a shared surname alone is more often a family member than a misspelling, and treating one as the other hid a genuinely unevidenced charge below the alerting threshold. candidate_name exposes what it matched against so the classification can be reviewed rather than trusted.';
