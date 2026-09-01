-- Clear the reschedule fields. Every value in them is an artefact.
--
-- crm-appointments.ts decided "this booking moved" by comparing two strings
-- that spell the same instant differently: event.startsAt is a toISOString()
-- result ("2026-07-17T14:30:00.000Z") and Postgres returns the same moment as
-- "2026-07-17T14:30:00+00:00". `!==` was therefore true on every pass for every
-- appointment, so the reschedule branch fired on every sync. It did two things:
--
--   rescheduled_from = current.scheduled_at   a no-op copy
--   reschedule_count = current.reschedule_count + 1
--
-- Both are visible in the data. All 364 rows that have rescheduled_from set
-- have it EXACTLY equal to scheduled_at, and none differ — the field carries no
-- information whatsoever. And reschedule_count counts sync passes: for every
-- creation date since 25 Aug 2026 there is exactly one distinct value across
-- all that day's rows, and it equals the number of nightly syncs since (6, 5,
-- 4, 3, 2, 1, 0 for 25th through 31st). The 21 Aug backfill spans 0-17 because
-- those rows were written in a single pass with mixed ages.
--
-- This mattered outside the database. BookingsTable renders
-- "Rescheduled: N time(s)" whenever reschedule_count > 0, so the client portal
-- has been telling practices that appointments were moved up to seventeen
-- times. Nothing in the PPS consolidation reads these fields; the fault was
-- found while proving an unrelated rule and is unrelated to that work.
--
-- Resetting rather than repairing, because there is nothing to repair to. A
-- genuine reschedule was never recorded: the branch overwrote rescheduled_from
-- with the current value on the very next pass, so real history was destroyed
-- as it was made. 0 and null here mean "not known", not "never happened".
-- From the next sync onward the counter is trustworthy going forward only.
update appointments
set rescheduled_from = null,
    reschedule_count = 0
where rescheduled_from is not null
   or reschedule_count <> 0;

comment on column appointments.reschedule_count is
  'How many times the CRM has moved this booking, counted from 1 Sep 2026. Reset to 0 in 0026 because a string-comparison bug made the sync increment it on every pass rather than on a real move — the values were a count of sync runs, and the client portal was showing them to practices. Values before that date are not recoverable.';

comment on column appointments.rescheduled_from is
  'The slot this booking previously occupied, or null if it has not moved since 1 Sep 2026. Cleared in 0026: the same bug overwrote it with the row''s own scheduled_at on every sync, so all 364 populated rows held a copy of scheduled_at and no real prior slot survived.';
