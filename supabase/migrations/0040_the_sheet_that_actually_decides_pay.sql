-- The two tabs the live commission calculation actually reads.
--
-- Established by reading the formulas rather than by assuming. DAILY BONUS
-- TALLY!B3 counts BOOKING SHEET by agent and date and subtracts twice the
-- matching INVALID BOOKINGS rows; STATS DASHBOARD reads that tally, and STATS
-- DASHBOARD is the sheet with Comms, Bonus and Salary on it.
--
-- Nothing in that chain touches the Client Fulfilment Tracker. The commission
-- work was built against tracker_appointments.booked_by, which is null on all
-- 1,281 rows and is not what anybody is paid from. These tables are the source
-- that is.
--
-- Two properties of BOOKING SHEET make it the better source anyway: it carries
-- exactly one date, which is the day the booking was made — the rule that was
-- confirmed — and its agent column IS the canonical name list, because DAILY
-- BONUS TALLY derives its columns from it with UNIQUE(). There is no spelling
-- mismatch possible between the two.

create table if not exists booking_sheet_rows (
  id uuid primary key default gen_random_uuid(),

  -- The sheet's own row number, so a row here can be found by eye in the sheet
  -- and so a re-run updates rather than duplicates.
  source_row integer not null unique,

  -- The day the booking was made. Column A, and the only date on the tab.
  booked_on date,

  -- Column B. Free text typed by a person, and the thing every payment is
  -- attributed by, so it is stored exactly as written and matched on later.
  agent text,

  patient_name text,
  patient_email text,
  location_name text,

  -- Column F. Its values are not yet known, which matters: whether the daily
  -- bonus should exclude no-shows depends on whether this carries attendance at
  -- all. Stored so the question can be answered from data.
  disposition text,

  imported_at timestamptz not null default now()
);

comment on table booking_sheet_rows is
  'BOOKING SHEET from the Call Center Agent Dashboard — the source the live pay '
  'calculation reads. Not the Client Fulfilment Tracker.';

create index if not exists booking_sheet_rows_agent_day
  on booking_sheet_rows (agent, booked_on)
  where agent is not null and booked_on is not null;

-- Invalid bookings, as reported on the Google Form behind the hidden tab.
--
-- Deliberately narrower than the form. The form collects the lead's name, and
-- this does not: the calculation needs the agent and the date and nothing else,
-- and a patient's name copied into a second system for no reason is a liability
-- rather than a record.
create table if not exists invalid_booking_reports (
  id uuid primary key default gen_random_uuid(),
  source_row integer not null unique,

  -- The form's own timestamp, and the date the invalid booking was made. The
  -- tally matches on the latter, so they are kept apart.
  reported_at timestamptz,
  invalid_on date,

  -- Free text on the form ("Name of Agent (Full Name)"), which is where a real
  -- spelling mismatch can occur: a typo here means the penalty silently fails
  -- to apply to anybody.
  agent text,

  reason text,
  notes text,

  imported_at timestamptz not null default now()
);

comment on table invalid_booking_reports is
  'Invalid bookings from the Google Form behind the INVALID BOOKINGS tab. The '
  'lead name the form collects is deliberately not stored.';

create index if not exists invalid_booking_reports_agent_day
  on invalid_booking_reports (agent, invalid_on)
  where agent is not null and invalid_on is not null;

-- Admin-only, like every other imported operational table. A client login must
-- never reach agent pay data.
alter table booking_sheet_rows enable row level security;
alter table invalid_booking_reports enable row level security;

create policy admin_all_booking_sheet_rows on booking_sheet_rows
  for all using (auth_is_admin()) with check (auth_is_admin());

create policy admin_all_invalid_booking_reports on invalid_booking_reports
  for all using (auth_is_admin()) with check (auth_is_admin());
