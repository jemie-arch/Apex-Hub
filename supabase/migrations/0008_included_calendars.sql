-- ===========================================================================
-- Calendars that ARE consultations but whose names do not say so.
--
-- The sync recognises a consultation calendar by name: anything ending
-- "Booking Calendar". That rule is strict on purpose — reading every calendar a
-- location had pulled in 1,026 non-consultation appointments out of 2,411,
-- 42.6%, from mirrors, blocked slots and personal calendars. Loosening the rule
-- would re-open that.
--
-- But a strict name rule misses a calendar that is genuinely a new-patient
-- consultation and simply named something else. A GoHighLevel audit on
-- 2026-08-24 found exactly that at Kind Dental: an Active, publicly bookable,
-- 45-minute Service calendar called "Ortho & New Patient Exam | Dr. Vohra",
-- mapped to a real chair via PatientSync. The practice had 32 tracker rows and
-- 10 charges against it while the Hub read zero appointments, because no
-- calendar matched the name rule.
--
-- So: the rule stays strict, and exceptions are recorded here deliberately.
-- This is the inclusive mirror of excluded_calendars, and the two are meant to
-- be read together — one removes calendars the name rule wrongly admits, this
-- one admits calendars the name rule wrongly removes.
--
-- Matching is by NAME, not id. The audit reported the calendar id as
-- Il8ovGGMeIc7dbtkmB2N but flagged that the UI font makes capital-I and
-- lowercase-l indistinguishable, so the id could not be transcribed with
-- confidence. A wrong id fails silently — it just never matches — whereas a
-- wrong name is visible in the alert the next time the sync runs. The id column
-- exists so it can be filled in once somebody copies it from the UI rather than
-- reading it off a screenshot, and it is checked as an alternative when present.
--
-- Every row needs a `confirmed_by`, because admitting a calendar makes its
-- appointments billable. That is a commercial decision, not a technical one, and
-- it should carry a name.
-- ===========================================================================
create table if not exists included_calendars (
  client_id        uuid not null references clients(id) on delete cascade,
  calendar_name    text not null,
  crm_calendar_id  text,
  reason           text not null,
  confirmed_by     text not null,
  included_at      timestamptz not null default now(),
  primary key (client_id, calendar_name)
);

comment on table included_calendars is
  'Calendars that are genuinely new-patient consultations but whose names do not end "Booking Calendar", so the sync name rule misses them. The inclusive mirror of excluded_calendars. Matched by name rather than id, because ids read off a UI screenshot cannot be transcribed reliably and a wrong id fails silently while a wrong name shows up in the next alert. confirmed_by is required: admitting a calendar makes its appointments billable, which is a commercial decision.';

alter table included_calendars enable row level security;

drop policy if exists included_calendars_admin_all on included_calendars;
create policy included_calendars_admin_all on included_calendars
  for all using (auth_is_admin()) with check (auth_is_admin());

-- ---------------------------------------------------------------------------
-- Kind Dental's real consultation calendar.
--
-- Confirmed in the GoHighLevel UI on 2026-08-24: Active, Service booking,
-- 45 minutes, public booking link on the custom slug /widget/bookings/npekd,
-- assigned to "Operatory 0 PatientSync", weekdays 08:00-17:00, and four
-- confirmed appointments in the preceding 30 days. The account holds a separate
-- "{{clinic.use}} Second_consultation" calendar, so this one is not carrying
-- second consults.
--
-- Deliberately NOT added at the same time: Skyline Implants & Periodontics'
-- "Implant Consultation, Manual Booking". It looks like the right kind of
-- calendar, but the account has had no appointment since 2024-09-04 and the
-- audit could not establish from the UI whether "Manual Booking" meant
-- new-patient consults or front-desk overflow entry. Admitting it would change
-- nothing today and could be wrong, so it stays out until somebody confirms.
-- ---------------------------------------------------------------------------
insert into included_calendars (client_id, calendar_name, reason, confirmed_by)
select c.id,
       'Ortho & New Patient Exam | Dr. Vohra',
       'Active, publicly bookable 45-minute Service calendar on a real PatientSync chair; confirmed new-patient consultations in a GoHighLevel UI audit on 2026-08-24. Second consults live on a separate calendar in this account.',
       'GHL UI audit 2026-08-24'
from clients c
where c.crm_location_id = 'KiGqpUllGNj1tJyPMpnX'
on conflict (client_id, calendar_name) do nothing;
