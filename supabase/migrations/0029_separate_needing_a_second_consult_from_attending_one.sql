-- Two different questions were sharing one column.
--
-- The GoHighLevel update form asks "Did this patient require a second
-- consultation?". The payload reader mapped that answer onto
-- `second_consult_showed`, which means something else entirely: whether the
-- patient turned up to the second consultation.
--
-- Needing one and attending one are independent. A patient can require a second
-- consult and not attend it — that is a no-show worth knowing about, and under
-- the old mapping it would have been recorded as a show. They can also attend
-- one nobody recorded as required.
--
-- The fault never fired: Make scenario 6109500 forwarded three fields and this
-- was not among them, so the alias sat dormant from the day it was written. It
-- was found while widening that scenario in 0028 — the widening would have
-- armed it.
--
-- So the column is added rather than the alias deleted. The answer is real, the
-- call centre already collects it, and the reason it looked like a duplicate is
-- that the Hub had nowhere else to put it.
--
-- Who answers what, after this:
--
--   second_consult_required   the call centre, on the update form
--   second_consult_showed     Call Center Mastery (scenarios 02 and 03, which
--                             split on a calendar name containing
--                             Second_consultation), or the practice in its
--                             portal, which asks "Did they attend a second
--                             consultation?"
--
-- Tri-state like every other answer on this table: null is "not asked", not
-- "no". A missing answer must never be billable as a negative.
alter table appointments
  add column if not exists second_consult_required boolean;

comment on column appointments.second_consult_required is
  'Whether the consultation concluded that a second one was needed, as recorded by the call centre. Null means not asked. Distinct from second_consult_showed, which is attendance at that second appointment and is answered by Call Center Mastery or by the practice - a patient can require one and not attend it. The two shared a column until 0029, where the mapping was wrong but dormant.';
