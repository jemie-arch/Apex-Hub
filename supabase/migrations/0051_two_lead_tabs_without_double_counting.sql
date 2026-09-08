-- Two lead tabs, one row number each, and no double counting.
--
-- WHAT WENT WRONG
--
-- tracker_leads is keyed on source_row alone. The hand import of 22 August
-- read one tab of the workbook; fulfilment-leads reads "Leads Data". Same row
-- numbers, different tabs — so the new rows upserted straight over the old
-- ones and pre-August history went with them.
--
-- Visible in the figure it moved: the week of 3 August read 377 leads and a
-- $34 cost per lead before, and 4 leads and $800 after. The current tab holds
-- only 33 rows earlier than 10 August, so it is not the record of that period
-- and never was.
--
-- Recent weeks were unaffected: the same tab, the same rows, refreshed. It is
-- the older history that had no second copy.
--
-- THE FIX, IN TWO PARTS
--
-- First, the key becomes (source_tab, source_row) — the same shape
-- appointment_ledger has used since it was written, and for the same reason.
-- Two tabs can then hold a row 27 each without one erasing the other.
--
-- Second, counting has to stay honest once both tabs are present, because
-- their periods may overlap and a lead in both would otherwise be counted
-- twice. Rather than match leads to each other by name and date — fuzzy, on a
-- column typed by hand — the rule is positional and absolute:
--
--   for any (practice, day), the live tab is the record if it has ANY row
--   for that day; the older tab is read only for days the live tab is silent
--   about.
--
-- So the live tab always wins where it speaks, the old tab fills the gap
-- behind it, and no lead can be counted twice regardless of how the two
-- overlap.

/*
 * Written to be safe to re-run, and to land on a half-finished version of
 * itself. Another session added source_tab while this was being written but
 * left the key alone, so the column existed and the thing it existed FOR did
 * not — a shape that is worse than either end of it, because the column looks
 * like the fix is in.
 */
alter table tracker_leads
  add column if not exists source_tab text not null default 'Leads Data';

comment on column tracker_leads.source_tab is
  'Which tab of the tracker the row came from. Part of the key: two tabs each '
  'have a row 27, and without this the second import silently overwrites the '
  'first — which is exactly how pre-August lead history was lost. Rows that '
  'predate this column are stamped "Leads Data" because that is what '
  'fulfilment-leads had just written over them with.';

alter table tracker_leads
  drop constraint if exists tracker_leads_source_row_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'tracker_leads'::regclass
      and conname = 'tracker_leads_tab_row_key'
  ) then
    alter table tracker_leads
      add constraint tracker_leads_tab_row_key unique (source_tab, source_row);
  end if;
end
$$;

/*
 * Asserted, because the key IS the migration. The column on its own changes
 * nothing — a second tab still overwrites the first while looking as though it
 * cannot, which is the state this arrived to find.
 */
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'tracker_leads'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (source_row)'
  ) then
    raise exception
      'tracker_leads is still unique on source_row alone, so the two tabs will '
      'keep overwriting each other. The namespaced key did not take.';
  end if;
end
$$;

/*
 * The deduplicating rule, in one place.
 *
 * Both v_cft_stats_dashboard and v_lead_reconciliation count these leads, so
 * the rule lives in a view they share. Two copies of it is how one of them
 * starts double counting while the other does not, and the difference would
 * show up as a cost per lead nobody could reconcile.
 */
create or replace view v_tracker_leads_effective
with (security_invoker = on) as
  select l.*
  from tracker_leads l
  where l.source_tab = 'Leads Data'
     or not exists (
       select 1
       from tracker_leads live
       where live.source_tab = 'Leads Data'
         -- `is not distinct from`, because client_id is null on the rows whose
         -- practice name matched nothing, and null = null would make every one
         -- of them fall through to the old tab as well as the new.
         and live.client_id is not distinct from l.client_id
         and live.received_on = l.received_on
     );

comment on view v_tracker_leads_effective is
  'tracker_leads with the two tabs reconciled: for any (practice, day) the '
  '"Leads Data" tab is the record if it has any row for that day, and an older '
  'tab is read only for days it is silent about. Positional rather than a '
  'match on name and date, because the names are typed by hand and a fuzzy '
  'join on them would be a guess about which leads are the same person. '
  'Count leads from here, never from tracker_leads directly.';

-- ---------------------------------------------------------------------------
-- Both consumers, pointed at the effective view.

create or replace view v_lead_reconciliation
with (security_invoker = on) as
  with crm as (
    select client_id, created_on as day, count(*) as crm_leads
    from crm_leads
    group by client_id, created_on
  ),
  sheet as (
    select client_id, received_on as day, sum(coalesce(lead_count, 1)) as sheet_leads
    from v_tracker_leads_effective
    where client_id is not null
    group by client_id, received_on
  ),
  meta as (
    select client_id, insight_on as day, sum(leads) as windsor_leads
    from ad_level_insights
    where client_id is not null
    group by client_id, insight_on
  ),
  spine as (
    select client_id, day from crm
    union select client_id, day from sheet
    union select client_id, day from meta
  )
  select
    s.client_id,
    c.name as client_name,
    c.group_id,
    s.day,
    coalesce(m.windsor_leads, 0)::bigint as windsor_leads,
    coalesce(t.sheet_leads, 0)::bigint   as sheet_leads,
    coalesce(g.crm_leads, 0)::bigint     as crm_leads,
    greatest(
      coalesce(m.windsor_leads, 0),
      coalesce(t.sheet_leads, 0)
    )::bigint as leads_best_reported,
    (greatest(coalesce(m.windsor_leads, 0), coalesce(t.sheet_leads, 0))
      - coalesce(g.crm_leads, 0))::bigint as reported_minus_crm
  from spine s
    join clients c on c.id = s.client_id
    left join crm   g on g.client_id = s.client_id and g.day = s.day
    left join sheet t on t.client_id = s.client_id and t.day = s.day
    left join meta  m on m.client_id = s.client_id and m.day = s.day;

comment on view v_lead_reconciliation is
  'One row per practice per day with all three lead counts and the gap. '
  'crm_leads is the reference: it is the only source that records a lead when '
  'it arrives rather than when somebody types it or Meta decides to report it. '
  'reported_minus_crm is signed — negative means the Hub reports more leads '
  'than the CRM holds, which is a different problem from reporting fewer. '
  'Sheet leads come from v_tracker_leads_effective, so a lead present in two '
  'tabs is counted once.';
