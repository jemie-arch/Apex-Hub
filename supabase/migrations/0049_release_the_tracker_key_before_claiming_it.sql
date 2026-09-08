-- The ledger rebuild claimed a key another row was still holding.
--
-- appointment-ledger has been failing fatally since the tracker was refreshed:
--
--   duplicate key value violates unique constraint "appointment_ledger_tracker_key"
--   Key (tracker_source_tab, tracker_source_row)=(Appointment Data, 27) already exists
--
-- It dies in 539ms before reading anything, so nothing reconciles: no exception
-- list, no unbilled backlog, no charge exceptions. The whole daily picture is
-- as of the cron run before the tracker was refreshed.
--
-- WHAT ACTUALLY HAPPENS
--
-- Step 2 matches each tracker row to a CRM-fed ledger row on
-- (client, patient name, appointment date) and stamps the tracker's
-- (tab, source_row) onto it. There is a unique constraint on that pair.
--
-- The stamp is never released. So when a rerun matches source_row 27 to a
-- DIFFERENT ledger row than last time — which happens whenever the CRM feed
-- gains an appointment that now matches, or the tracker's own row content
-- changes — the new row is given a key the old row still holds, and the
-- statement aborts.
--
-- A latent bug, not a new one. Refreshing 1,219 tracker rows for the first
-- time since 22 August is simply what finally moved a match.
--
-- NOT A NUMBERING PROBLEM, which was the first suspicion and worth recording
-- as ruled out. Both imports number rows by the sheet's own row number, so
-- source_row 27 means sheet row 27 in each. The old import additionally wrote
-- rows 3 and 4 — the banner above the headings — and left a 66-row tail beyond
-- the sheet's current extent, but it did not shift the numbering of real rows.
--
-- THE FIX
--
-- Release the linkage from CRM-bearing rows before the merge reassigns it.
-- Those rows are exactly the ones step 2 re-derives, so clearing them costs
-- nothing: whatever still matches is stamped again in the same transaction.
--
-- Nothing is deleted. Tracker-only rows keep their linkage, so the insert's
-- `not exists` guard still stops it duplicating them — and the case where a
-- tracker-only row holds a key a CRM row would claim was measured before
-- writing this: zero rows. Had it not been zero, the honest fix would have
-- been merging duplicates, which is a billing decision and not one to take
-- inside a migration.

do $outer$
declare
  src     text;
  patched text;
  anchor  text := '  with trk as (';
  release text := $release$  /*
   * RELEASE BEFORE CLAIM.
   *
   * The merge below stamps (tracker_source_tab, tracker_source_row) onto the
   * CRM-fed row that matches each tracker row, and that pair is unique. Left
   * from a previous run, an old stamp collides the moment a match moves to a
   * different row — which is what killed every run after the tracker was
   * refreshed on 8 September 2026.
   *
   * Cleared only on rows that carry a crm_appointment_id, because those are
   * the rows the merge re-derives; anything that still matches is stamped
   * again a few lines below. Tracker-only rows keep theirs, so the insert at
   * the end of this step still sees them and does not duplicate them.
   */
  update appointment_ledger
  set tracker_source_tab = null,
      tracker_source_row = null
  where tracker_source_row is not null
    and crm_appointment_id is not null;

$release$;
begin
  select prosrc into src from pg_proc where proname = 'rebuild_appointment_ledger';

  if src is null then
    raise exception 'rebuild_appointment_ledger does not exist; nothing to patch.';
  end if;

  -- Idempotent: a re-run must not stack a second copy of the release.
  if position('RELEASE BEFORE CLAIM' in src) > 0 then
    raise notice 'rebuild_appointment_ledger already releases before claiming; left alone.';
    return;
  end if;

  /*
   * Asserted, not assumed. Patching a function by text is only safe while the
   * anchor is unique — two matches would put the release in the wrong branch,
   * and none would silently do nothing at all.
   */
  if position(anchor in src) = 0 then
    raise exception
      'Could not find the tracker feed''s WITH clause in '
      'rebuild_appointment_ledger. The function has been rewritten; add the '
      'release by hand rather than trusting this patch.';
  end if;

  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception
      'The anchor "%" appears more than once in rebuild_appointment_ledger, so '
      'a textual patch cannot say which one it means.', anchor;
  end if;

  patched := replace(src, anchor, release || anchor);

  execute format(
    'create or replace function public.rebuild_appointment_ledger() '
    'returns jsonb language plpgsql security definer '
    'set search_path to ''public'', ''pg_temp'' as %L',
    patched
  );

  -- Confirm the rewrite took, rather than trusting that EXECUTE did what it
  -- was told.
  select prosrc into src from pg_proc where proname = 'rebuild_appointment_ledger';
  if position('RELEASE BEFORE CLAIM' in src) = 0 then
    raise exception 'The patch did not apply. rebuild_appointment_ledger is unchanged.';
  end if;
end
$outer$;
