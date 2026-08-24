-- ===========================================================================
-- What the delivered-but-uninvoiced backlog is worth.
--
-- The PPS audit concluded the per-appointment rate was "not recoverable from
-- Make or GHL", and that was true — but it was measured before Stripe was in
-- this database. It is recoverable from what was actually charged.
--
-- The rate structure is visible in the charge data and is unambiguous: dividing
-- each consult charge by its consult count yields a small set of repeated unit
-- prices, and the dominant one is 20291 cents. That is 19700 x 1.03 exactly —
-- the base rate plus the 3% processing uplift Apex adds. The same relationship
-- holds for the other tiers (15141 = 14700 x 1.03, 8755 = 8500 x 1.03), which is
-- what confirms this is a real price list rather than a coincidence of averages.
--
-- Two things these views are deliberately careful about.
--
-- First, 'billable' means no succeeded Stripe charge could be matched to a show.
-- It does NOT prove the work was never invoiced. It could have been invoiced
-- outside Stripe, waived, disputed, or covered by a retainer. So everything here
-- is named an ESTIMATE of exposure, not receivable revenue. Calling it revenue
-- would be the same overstatement this whole reconciliation exists to remove.
--
-- Second, age is reported rather than smoothed. A show from last week being
-- unbilled is ordinary billing lag; a show from December is not the same thing,
-- and one number covering both hides the finding. When this was written only 28
-- of 489 unbilled shows sat inside two weeks.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The rate each practice is actually charged, derived from its own charges.
--
-- Modal rather than mean: a practice can have one odd charge (a manual
-- adjustment, a partial refund, a bundled month) and an average quietly folds
-- that into every future estimate. The most-used unit price is the contract
-- price; an outlier is an outlier.
-- ---------------------------------------------------------------------------
create or replace view practice_rate_card as
with unit as (
  select
    b.client_id,
    round(b.amount_cents::numeric
          / greatest(coalesce(b.consult_count, 1), 1))::bigint as unit_cents,
    sum(greatest(coalesce(b.consult_count, 1), 1)) as consult_lines
  from billing_charges b
  where b.outcome = 'succeeded'
    and b.client_id is not null
    and coalesce(array_length(b.consult_names, 1), 0) > 0
  group by b.client_id, 2
),
ranked as (
  select client_id, unit_cents, consult_lines,
         row_number() over (
           partition by client_id
           order by consult_lines desc, unit_cents desc
         ) as rk,
         sum(consult_lines) over (partition by client_id) as total_lines
  from unit
)
select
  r.client_id,
  c.name as practice,
  r.unit_cents,
  -- Reported alongside the billed figure because the base rate is the number
  -- that appears in a contract, and the billed figure is the one that appears
  -- on a card statement. Confusing the two is how a rate dispute starts.
  round(r.unit_cents / 1.03)::bigint as implied_base_cents,
  r.consult_lines as lines_at_this_rate,
  r.total_lines as lines_total,
  -- How much to trust it. One charge is a data point; twenty is a price.
  case
    when r.consult_lines >= 10 then 'high'
    when r.consult_lines >= 3  then 'medium'
    else 'low'
  end as confidence
from ranked r
join clients c on c.id = r.client_id
where r.rk = 1;

comment on view practice_rate_card is
  'The per-consultation rate each practice is actually charged, derived from its own succeeded Stripe charges. Modal rather than mean, so a one-off adjustment does not contaminate every future estimate. implied_base_cents strips the 3% processing uplift, because the base rate is what appears in a contract and the billed rate is what appears on a statement.';

-- ---------------------------------------------------------------------------
-- Delivered work with no matching charge, valued and aged.
-- ---------------------------------------------------------------------------
create or replace view unbilled_backlog as
with fleet as (
  -- The fallback for a practice that has never been charged, so has no rate of
  -- its own. Modal across the fleet, and every row using it is labelled, so an
  -- assumed figure can never be mistaken for a measured one.
  select unit_cents from (
    select round(b.amount_cents::numeric
                 / greatest(coalesce(b.consult_count, 1), 1))::bigint as unit_cents,
           sum(greatest(coalesce(b.consult_count, 1), 1)) as lines
    from billing_charges b
    where b.outcome = 'succeeded'
      and coalesce(array_length(b.consult_names, 1), 0) > 0
    group by 1
    order by lines desc
    limit 1
  ) t
)
select
  l.id as ledger_id,
  l.client_id,
  c.name as practice,
  g.status as client_status,
  l.patient_name,
  l.appointment_at,
  (current_date - l.appointment_at::date) as days_old,
  coalesce(rc.unit_cents, f.unit_cents) as est_value_cents,
  case when rc.unit_cents is null then 'fleet assumption' else 'this practice' end
    as rate_basis,
  rc.confidence as rate_confidence,
  case
    when l.appointment_at >= now() - interval '14 days'  then 'normal lag'
    when l.appointment_at >= now() - interval '30 days'  then '2 to 4 weeks'
    when l.appointment_at >= now() - interval '90 days'  then '1 to 3 months'
    when l.appointment_at >= now() - interval '180 days' then '3 to 6 months'
    else 'over 6 months'
  end as age_band,
  -- The one number worth alerting on. Inside two weeks this is just billing in
  -- progress; past a month somebody has to explain it.
  (l.appointment_at < now() - interval '30 days') as is_aged
from appointment_ledger l
join clients c on c.id = l.client_id
left join client_groups g on g.id = c.group_id
left join practice_rate_card rc on rc.client_id = l.client_id
cross join fleet f
where l.outcome = 'showed'
  and l.billing_state = 'billable'
  and l.appointment_at is not null;

comment on view unbilled_backlog is
  'Shows with no matching succeeded Stripe charge, valued from practice_rate_card and aged. An ESTIMATE of exposure, not receivable revenue: billing_state billable means no charge could be matched, which does not prove the work was never invoiced — it may have been invoiced outside Stripe, waived, disputed or covered by a retainer. Rows priced from a fleet assumption rather than the practice own rate are labelled as such.';
