-- Let the ledger survive two CRM appointments for the same consultation.
--
-- rebuild_appointment_ledger step 2 pairs each tracker row to a CRM-keyed
-- ledger row on client + patient name + date, then stamps the tracker key onto
-- the match. The join is one-to-many: when GoHighLevel holds two appointment
-- records for the same patient on the same day, `paired` yields two rows for one
-- tracker row and the update writes the same (tracker_source_tab,
-- tracker_source_row) to both, which appointment_ledger_tracker_key rejects. The
-- function is one statement, so the whole rebuild aborts and every
-- reconciliation number goes stale. It did: the 3 September nightly run
-- returned read 0, created 0, fatal 23505.
--
-- This is not the collision 0030 fixed. That one was a tracker-only row being
-- superseded by a CRM row, and its merge ran fine that morning -- 105 rows. This
-- is two CRM rows competing for one tracker row, which no pre-step can prevent,
-- because those ledger rows do not exist until step 1 of the same function
-- creates them.
--
-- I caused it. Widening crm-appointments from a rolling 45 days to 2025-01-01
-- onward backfilled 1,006 appointments, and four of them are exact duplicates --
-- same practice, same patient, same calendar, identical time, between
-- 5 February and 31 March. Those months had simply never been read. The
-- duplicates are real records in the CRM, so the ledger has to tolerate them
-- rather than wait for the CRM to be corrected.
--
-- Fixed by making the pairing pick ONE ledger row per tracker row, ordered by
-- appointment time then id so the choice is deterministic rather than whatever
-- the planner happens to return first. A tracker row that loses the race is not
-- lost: it falls through to the insert below and becomes its own tracker-only
-- ledger row, which is the honest representation of a duplicate.
--
-- Patched textually against the live definition rather than retyped. The
-- alternative was restating 177 lines of billing logic from a partial reading of
-- it, and a transcription slip there would cost far more than this bug. Both
-- replacements are asserted, so whitespace drift fails loudly instead of quietly
-- leaving the fault in place.
do $patch$
declare
  src     text;
  patched text;
  find_1  text := E'    select trk.*, l.id as ledger_id';
  put_1   text := E'    select distinct on (trk.tab, trk.source_row) trk.*, l.id as ledger_id';
  find_2  text := E'     and l.crm_appointment_id is not null\n  ),';
  put_2   text := E'     and l.crm_appointment_id is not null\n    order by trk.tab, trk.source_row, l.appointment_at nulls last, l.id\n  ),';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'rebuild_appointment_ledger';

  if src is null then
    raise exception 'rebuild_appointment_ledger not found';
  end if;

  -- Already patched: this migration is idempotent, so a replay is a no-op
  -- rather than a failure.
  if position('distinct on (trk.tab, trk.source_row)' in src) > 0 then
    return;
  end if;

  if position(find_1 in src) = 0 then
    raise exception 'the paired select does not look as expected; not patching';
  end if;
  if position(find_2 in src) = 0 then
    raise exception 'the paired join tail does not look as expected; not patching';
  end if;

  patched := replace(src, find_1, put_1);
  patched := replace(patched, find_2, put_2);

  if patched = src then
    raise exception 'patch produced no change';
  end if;

  execute patched;
end
$patch$;

-- Prove the change is in the live function rather than trusting the DO block.
do $verify$
declare body text;
begin
  select pg_get_functiondef(p.oid) into body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'rebuild_appointment_ledger';

  if position('distinct on (trk.tab, trk.source_row)' in body) = 0 then
    raise exception 'the distinct-on did not land';
  end if;
  if position('order by trk.tab, trk.source_row, l.appointment_at nulls last, l.id' in body) = 0 then
    raise exception 'the deterministic order did not land';
  end if;
end
$verify$;
