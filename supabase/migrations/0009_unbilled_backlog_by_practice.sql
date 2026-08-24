-- ===========================================================================
-- The aged backlog, already grouped.
--
-- /reconciliation was fetching all 487 unbilled_backlog rows — each carrying a
-- patient name — and then aggregating them in the page to render twelve. Two
-- things wrong with that: it shipped roughly forty times more data than it
-- displayed across a trans-Pacific connection, and it put patient names on the
-- wire to produce a total that does not contain any.
--
-- Grouping in the database fixes both. The row-level view stays for anybody who
-- needs the detail; this is what the summary table reads.
-- ===========================================================================
create or replace view unbilled_backlog_by_practice as
select
  b.client_id,
  b.practice,
  b.client_status,
  count(*)                                   as aged_shows,
  sum(b.est_value_cents)                     as est_value_cents,
  max(b.days_old)                            as oldest_days,
  -- Whether any row in the group leaned on the fleet rate rather than the
  -- practice's own charges. Surfaced so a total built partly on an assumption
  -- cannot be read as a measurement.
  bool_or(b.rate_basis = 'fleet assumption') as partly_assumed
from unbilled_backlog b
where b.is_aged
group by b.client_id, b.practice, b.client_status;

comment on view unbilled_backlog_by_practice is
  'unbilled_backlog grouped by practice, aged rows only. Exists so the reconciliation summary does not fetch 487 patient-level rows to render twelve totals — it shipped forty times the data it displayed, and carried patient names to produce a figure that contains none. Use unbilled_backlog itself when the per-appointment detail is actually needed.';
