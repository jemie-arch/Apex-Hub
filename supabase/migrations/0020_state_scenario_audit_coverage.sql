-- How much of the fleet the sheet audit has actually looked at.
--
-- The findings table spent a fortnight holding ten findings drawn from fourteen
-- scenarios while the fleet was fifty-nine. Read without that denominator, a
-- panel showing "10 findings" says the fleet was examined and is nearly clean.
-- It said no such thing. It said fourteen scenarios were examined.
--
-- This is the same fault the whole engagement is about — a display that reads as
-- complete when it is partial — and it was introduced by loading routing data
-- without loading the audit data beside it. Hence a view rather than a note in a
-- report: the number that qualifies the findings should be impossible to fetch
-- the findings without.
--
-- Deliberately does not hardcode how many scenarios exist in Make. That total
-- changes whenever somebody clones one, and a stale denominator would be worse
-- than none — it would read as authoritative. Coverage is stated as what was
-- observed and when, so a reader can see for themselves whether it is current.
create or replace view scenario_audit_coverage as
select
  count(distinct t.scenario_id)                        as scenarios_audited,
  count(*)                                             as module_rows,
  count(distinct t.spreadsheet_id)                     as distinct_sheets,
  count(distinct t.scenario_id) filter (where t.is_active) as active_scenarios,
  (select count(*) from scenario_sheet_findings)       as findings,
  min(t.observed_at)                                   as oldest_observation,
  max(t.observed_at)                                   as newest_observation,
  -- Plain-language line a page can print without doing arithmetic of its own.
  'Findings cover ' || count(distinct t.scenario_id) ||
  ' booking scenarios read between ' ||
  to_char(min(t.observed_at), 'DD Mon YYYY') || ' and ' ||
  to_char(max(t.observed_at), 'DD Mon YYYY') ||
  '. Any scenario not in that set has not been checked, and its absence from the ' ||
  'findings means nothing.'                            as caveat
from scenario_sheet_targets t;

comment on view scenario_audit_coverage is
  'The denominator for scenario_sheet_findings. Read the findings without it and a partial audit looks like a clean fleet — which is exactly the class of fault the audit exists to catch. Carries a ready-made caveat sentence so a page cannot accidentally present findings as complete.';
