-- Take back the 40 outcomes 0031 wrote for patients who never arrived.
--
-- 0031 read tracker_appointments.status_if_showed and mapped DQ to
-- 'unqualified'. The column name is the specification and I did not read it
-- closely enough: it is the status IF the patient showed. For a no-show it
-- should be empty, and on 182 rows it correctly is.
--
-- On 152 it is not. Those rows say "No Show" in appointment_status and "DQ" in
-- status_if_showed, which is the call centre writing off a lead rather than
-- reporting a consultation -- the patient never came, so there was no
-- consultation to be disqualified at. 40 of them reached appointments through
-- the ledger and got outcome = 'unqualified'. The Hub's own feed independently
-- says showed = false on 36 of those 40.
--
-- Why this is worth a migration rather than a shrug. 'unqualified' is an
-- outcome, and an outcome asserts that the consultation happened and went
-- badly. On the portal card that lands in the answered count, so a practice
-- reads "none of 12 recorded" where several of the 12 were people who never
-- walked in -- their no-show rate re-reported as a qualification failure. It
-- would also give appointment_exceptions an outcome where it expects none.
--
-- The 58 'won' rows are unaffected and were checked: all come from tracker
-- rows marked Showed, and the Hub agrees on 56, with one contradiction and one
-- unknown. The 100 'unqualified' rows from Showed rows are also correct.
--
-- Not fixed here, deliberately: two rows where the tracker says Showed and the
-- Hub says showed = false. Two feeds disagreeing about attendance is the
-- disagreement the ledger exists to surface, not something to resolve by
-- picking a winner in a migration.
--
-- Attendance is still left alone. This only withdraws an outcome that was
-- never anybody's answer.
with no_show_outcomes as (
  select a.id
  from appointments a
  join appointment_ledger l
    on l.crm_appointment_id = a.crm_appointment_id
  join tracker_appointments t
    on  t.source_row        = l.tracker_source_row
    and l.tracker_source_tab = 'Appointment Data'
    and t.client_id         = l.client_id
  where a.outcome_source = 'tracker'
    and a.outcome = 'unqualified'
    and btrim(t.appointment_status) = 'No Show'
)
update appointments a
   set outcome            = 'pending',
       outcome_source     = null,
       outcome_updated_at = null
  from no_show_outcomes n
 where a.id = n.id
   -- Only withdraw what 0031 put there. If a practice or the call centre has
   -- since answered this row for real, that answer stands.
   and a.outcome_source = 'tracker';
