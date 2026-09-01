-- Who answered the outcome, so the answer can be defended.
--
-- `showed_source` already records who said whether the patient attended: 'crm'
-- from the calendar, 'call_centre' from the team, 'client' from the practice.
-- crm-appointments.ts reads it and refuses to let the nightly sync overwrite an
-- answer the practice gave, which is the promise the portal makes on screen:
-- "Nothing you type here is overwritten by our systems."
--
-- The other half of the survey has no such marker. Outcome, treatment value,
-- financing, card-on-file and notes are written by three different parties --
-- the practice through /portal, the call centre through /b2c, and the
-- GoHighLevel update form through /api/webhooks/consultation-outcome -- and
-- nothing records which. So whoever writes last wins, silently, and a practice's
-- treatment value can be replaced by a call-centre guess with no trace. That is
-- precisely the failure the stat sheets had, reproduced in Postgres.
--
-- One column fixes it, mirroring showed_source rather than inventing a second
-- vocabulary. The ledger already settled on these words in
-- `ledger_outcome_source`; this is the appointments-side equivalent.
alter table appointments
  add column if not exists outcome_source text;

comment on column appointments.outcome_source is
  'Who last answered the outcome half of the consultation survey - outcome, value_cents, financing_approved, cc_on_file, notes, lead_quality. One of ''client'' (the practice, through their portal), ''call_centre'' (the team, through /b2c or the GoHighLevel update form), ''crm'', or ''tracker''. Mirrors showed_source, which does the same job for attendance. Null means nobody has answered. The practice''s answer is authoritative: a later writer may fill a field that is still blank but must not replace one they set.';

-- Deliberately not backfilled. Every row currently reads outcome = 'pending'
-- with outcome_updated_at null, so nobody has answered anything yet and null is
-- the honest value. Inventing a source for 369 unanswered rows would assert
-- something untrue on day one.
