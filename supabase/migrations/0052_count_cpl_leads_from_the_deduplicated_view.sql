-- Count the leads CPL divides by from the deduplicated view.
--
-- 0051 gave tracker_leads a tab-namespaced key so the workbook's two lead tabs
-- can coexist, and v_tracker_leads_effective is the rule that keeps them from
-- being counted twice: the live tab is the record for any (practice, day) it
-- has a row for, and an older tab is read only for days it is silent about.
--
-- v_cft_stats_dashboard still summed tracker_leads directly. That is fine
-- while one tab is loaded and wrong the moment the second is — every day both
-- tabs cover would count its leads twice, halving the cost per lead on exactly
-- the historical weeks this work exists to restore.
--
-- So it is repointed BEFORE the second tab is imported, rather than after
-- somebody notices CPL has halved. One line, one occurrence, asserted.

do $$
declare
  src     text;
  patched text;
  anchor  text := 'FROM tracker_leads';
  hits    integer;
begin
  select pg_get_viewdef('v_cft_stats_dashboard'::regclass, true) into src;

  if src is null then
    raise exception 'v_cft_stats_dashboard does not exist; nothing to repoint.';
  end if;

  if position('v_tracker_leads_effective' in src) > 0 then
    raise notice 'v_cft_stats_dashboard already reads the effective view; left alone.';
    return;
  end if;

  hits := (length(src) - length(replace(src, anchor, ''))) / length(anchor);

  /*
   * Exactly one, asserted both ways. Two would mean the view gained another
   * reader of this table and a blind replace would repoint both — one of which
   * might legitimately want every row. None would mean it has been rewritten
   * and this patch is guessing.
   */
  if hits <> 1 then
    raise exception
      'Expected exactly one "FROM tracker_leads" in v_cft_stats_dashboard, '
      'found %. Repoint it by hand rather than trusting this patch.', hits;
  end if;

  /*
   * ALIASED as tracker_leads, which is not cosmetic.
   *
   * Every column inside that CTE is qualified — tracker_leads.client_id,
   * tracker_leads.received_on — so repointing the FROM alone leaves the
   * qualifiers pointing at a table no longer in the clause, and Postgres
   * refuses the whole view with "missing FROM-clause entry". The alias keeps
   * every reference valid and changes only where the rows come from.
   */
  patched := replace(
    src, anchor, 'FROM v_tracker_leads_effective tracker_leads'
  );

  execute format(
    'create or replace view public.v_cft_stats_dashboard '
    'with (security_invoker = on) as %s',
    patched
  );

  select pg_get_viewdef('v_cft_stats_dashboard'::regclass, true) into src;
  if position('v_tracker_leads_effective' in src) = 0 then
    raise exception 'The repoint did not apply. v_cft_stats_dashboard is unchanged.';
  end if;
end
$$;
