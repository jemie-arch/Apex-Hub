-- Load the treatment outcomes the tracker has been holding all along.
--
-- 0027 added outcome_source and deliberately did not backfill it, on the
-- grounds that "every row currently reads outcome = 'pending' with
-- outcome_updated_at null, so nobody has answered anything yet". The first half
-- was true. The second was not: somebody had answered, just not anywhere the
-- Hub was reading.
--
-- tracker_appointments.status_if_showed carries 918 answered consultations --
-- 531 DQ, 380 Closed, 7 Follow up -- imported with the rest of the tracker and
-- then never read by anything. Not the sync, not the ledger (whose own
-- `outcome` column is attendance: showed / no_show / cancelled), not the
-- portal. So appointments.outcome stayed 'pending' on all 386 rows.
--
-- That is not a cosmetic gap. portal/[token] is the client-facing report -- the
-- "Client Report Send out System" -- and its third card reads "Started
-- treatment" straight off appointments.outcome = 'won'. With no outcomes
-- loaded it renders 0 with a "$0 in value" hint, beside an Ad spend card
-- showing real money: $65,659.66 across 32 practices in the last 30 days. The
-- report was arithmetically correct and told every practice their advertising
-- converted nothing.
--
-- Mapping, from the tracker's own vocabulary to the appointment_outcome enum:
--
--   Closed    -> won          the consultation closed, treatment started
--   DQ        -> unqualified  disqualified at or before the consultation
--   Follow up -> follow_up
--
-- Verified before writing: the join is 1:1 across all 198 reachable rows, no
-- appointment matches two tracker rows that disagree, and every non-blank
-- status maps to a known enum value. Blank stays pending -- silence is not data.
--
-- What this deliberately does NOT do:
--
--   * It does not touch `showed`. Attendance is governed by showed_source and
--     the calendar is the better witness. "status IF showed" implies attendance
--     but does not assert it, and inferring one from the other would put a
--     guess in the column the billing exceptions read.
--
--   * It does not invent value_cents. The tracker has no treatment-value
--     column, so a row becomes 'won' with a null value. The portal must render
--     that as "value not recorded" rather than "$0" -- fixed alongside this in
--     portal/[token]/page.tsx. Writing 0 here would be the same lie in the
--     other direction.
--
-- Reversible by provenance: everything written here is stamped
-- outcome_source = 'tracker', so
--
--   update appointments set outcome = 'pending', outcome_source = null,
--          outcome_updated_at = null
--    where outcome_source = 'tracker';
--
-- puts it back exactly.
with mapped as (
  select
    a.id as appointment_id,
    case btrim(t.status_if_showed)
      when 'Closed'    then 'won'
      when 'DQ'        then 'unqualified'
      when 'Follow up' then 'follow_up'
    end::appointment_outcome as outcome
  from tracker_appointments t
  join appointment_ledger l
    on  l.tracker_source_row = t.source_row
    and l.tracker_source_tab = 'Appointment Data'
    and l.client_id          = t.client_id
  join appointments a
    on a.crm_appointment_id = l.crm_appointment_id
  where nullif(btrim(t.status_if_showed), '') is not null
)
update appointments a
   set outcome            = m.outcome,
       outcome_source     = 'tracker',
       outcome_updated_at = now()
  from mapped m
 where a.id = m.appointment_id
   and m.outcome is not null
   -- Precedence, the same rule lib/outcomes/precedence.ts enforces at runtime:
   -- the tracker may fill a blank, never replace an answer. Both clauses are
   -- currently true of every target row; they are here so a re-run after real
   -- answers arrive cannot undo them.
   and a.outcome = 'pending'
   and a.outcome_source is null;
