-- ===========================================================================
-- Catch a booking missing from the tracker BEFORE the patient arrives.
--
-- The view already had a clause for this, and it was past-tense:
--
--   WHEN NOT seen_in ? 'tracker' AND appointment_at < now()
--     THEN 'happened but never written to the tracker'   -- severity 5
--
-- So it only fired once the appointment was over, at the lowest severity, in
-- among 487 rows of billing backlog. By then nothing can be done: the practice
-- had no row to record an outcome against, so there is no show, and with no show
-- there is no invoice.
--
-- The window where it is fixable is before the appointment. Marlene Gonzalez at
-- Ultra Smiles was booked on 20 August for the 25th, her Make execution halted
-- at the parser and wrote nothing, the replay on the 21st halted again — and
-- this view stayed silent for four days because her appointment had not happened
-- yet. She was found by hand, the day before, by reading Make execution logs.
--
-- This adds the forward-looking half at severity 2, so a booking that exists in
-- GoHighLevel and not in the tracker is reported while somebody can still write
-- the row. The past-tense clause stays exactly as it was: once the appointment
-- has passed it genuinely is a backlog item rather than an intervention.
--
-- Placed after the two money-and-evidence clauses and before 'outcome overdue'.
-- An upcoming appointment cannot be overdue for an outcome, and cannot be
-- 'dispositioned but never on a calendar' or 'in the tracker only' — both of
-- those require the opposite feed to be the missing one — so the new clause
-- cannot shadow anything above or below it.
--
-- Verified before writing: `tracker_source_row IS NULL` and
-- `NOT seen_in ? 'tracker'` agree on all 31 affected rows, zero disagreements.
-- The seen_in form is used to match its sibling clause.
--
-- What this is NOT: proof the PPS template dropped the booking. The ledger pairs
-- feeds on patient name and date, so a spelling difference or a mismatched date
-- also lands a row here. Six of the current rows are confirmed drops by Make
-- execution id; the rest are candidates. The alert says what it knows — the
-- tracker has no row — and leaves the cause to whoever looks.
-- ===========================================================================
create or replace view appointment_exceptions as
 WITH bounds AS (
         SELECT min(appointment_ledger.appointment_at) AS crm_from
           FROM appointment_ledger
          WHERE appointment_ledger.crm_appointment_id IS NOT NULL
        ), flagged AS (
         SELECT l.id,
            l.client_id,
            l.crm_appointment_id,
            l.tracker_source_row,
            l.patient_name,
            l.source,
            l.appointment_at,
            l.outcome,
            l.outcome_source,
            l.outcome_due_at,
            l.billing_state,
            l.amount_cents,
                CASE
                    WHEN l.billing_state = 'billed'::ledger_billing_state AND l.outcome <> 'showed'::ledger_outcome THEN 'billed without a recorded show'::text
                    WHEN l.missing_since IS NOT NULL AND l.outcome = 'pending'::ledger_outcome THEN 'vanished from the CRM while still open'::text
                    -- The new clause. Fixable only while the appointment is ahead.
                    WHEN l.crm_appointment_id IS NOT NULL AND NOT l.seen_in ? 'tracker'::text AND l.appointment_at >= now() THEN 'booked in the CRM, missing from the tracker, still ahead'::text
                    WHEN l.outcome = 'pending'::ledger_outcome AND l.outcome_due_at < now() THEN 'outcome overdue'::text
                    WHEN l.dispositioned_at IS NOT NULL AND l.calendar_seen_at IS NULL AND l.appointment_at >= b.crm_from THEN 'dispositioned but never on a calendar'::text
                    WHEN NOT l.seen_in ? 'crm'::text AND NOT l.seen_in ? 'hp'::text AND l.appointment_at >= b.crm_from THEN 'in the tracker only'::text
                    WHEN NOT l.seen_in ? 'tracker'::text AND l.appointment_at < now() THEN 'happened but never written to the tracker'::text
                    WHEN l.outcome = 'showed'::ledger_outcome AND (l.client_calendar_state = ANY (ARRAY['manual'::text, 'one_way'::text, 'unknown'::text])) AND l.client_calendar_checked_at IS NULL THEN 'never verified against the practice calendar'::text
                    WHEN l.outcome = 'showed'::ledger_outcome AND l.billing_state = 'billable'::ledger_billing_state THEN 'delivered, not yet billed'::text
                    WHEN l.billing_state = 'on_hold'::ledger_billing_state AND COALESCE(btrim(l.billing_hold_reason), ''::text) = ''::text THEN 'on hold with no reason given'::text
                    WHEN l.raw_disposition IS NOT NULL AND l.outcome = 'pending'::ledger_outcome THEN 'disposition did not map to an outcome'::text
                    ELSE NULL::text
                END AS exception,
                CASE
                    WHEN l.billing_state = 'billed'::ledger_billing_state AND l.outcome <> 'showed'::ledger_outcome THEN 1
                    WHEN l.missing_since IS NOT NULL AND l.outcome = 'pending'::ledger_outcome THEN 2
                    WHEN l.crm_appointment_id IS NOT NULL AND NOT l.seen_in ? 'tracker'::text AND l.appointment_at >= now() THEN 2
                    WHEN l.outcome = 'pending'::ledger_outcome AND l.outcome_due_at < now() THEN 3
                    WHEN l.dispositioned_at IS NOT NULL AND l.calendar_seen_at IS NULL AND l.appointment_at >= b.crm_from THEN 4
                    ELSE 5
                END AS severity
           FROM appointment_ledger l
             CROSS JOIN bounds b
        )
 SELECT f.id,
    f.client_id,
    c.name AS practice,
    f.patient_name,
    f.appointment_at,
    f.source,
    f.outcome,
    f.outcome_source,
    f.outcome_due_at,
    f.billing_state,
    f.amount_cents,
    f.exception,
    f.severity,
    -- Days until the appointment, so the worklist can be ordered by urgency
    -- rather than by when the row happened to be created. Negative once past.
    (f.appointment_at::date - CURRENT_DATE) AS days_away
   FROM flagged f
     JOIN clients c ON c.id = f.client_id
  WHERE f.exception IS NOT NULL;

comment on view appointment_exceptions is
  'Appointments needing attention, most severe first. The clause "booked in the CRM, missing from the tracker, still ahead" is severity 2 deliberately: it is the only window in which a missing tracker row can still be written before the patient arrives. Its past-tense sibling stays at severity 5, because once the appointment has passed it is a backlog item rather than an intervention. Neither clause proves the PPS template dropped the booking — the ledger pairs feeds on name and date, so a spelling or date mismatch lands here too.';
