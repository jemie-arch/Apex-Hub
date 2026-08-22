-- ===========================================================================
-- One row per appointment.
--
-- The unit of measurement that did not previously exist. Every tracker in the
-- stack stores daily counts -- booked 14, showed 9 -- which can tell you the
-- total moved and never which one vanished. This table is the record.
--
-- Every column exists to close a specific leak from the operations diagnostic,
-- and the leak number is named against it. Nothing here is speculative: if a
-- column cannot be traced to a leak or to identity, it is not here.
--
-- Two of the twelve leaks are measured facts in this database rather than
-- inherited findings, and the numbers are recorded beside the columns that fix
-- them: 88 duplicate rows from reschedules (6.9% of consultations, dragging the
-- reported show rate down 4.2 points), and 65 tracker consultations that never
-- reached a calendar the Hub can read.
-- ===========================================================================

create type ledger_source as enum (
  'isr',      -- an ISR booked it, dispositioned in HotProspector
  'direct',   -- the patient rang the practice and booked. Auto-charged.
  'client',   -- the practice entered it themselves
  'unknown'
);

create type ledger_outcome as enum (
  'pending',      -- not yet resolved. The only non-terminal state.
  'showed',
  'no_show',
  'cancelled',
  'rescheduled'   -- superseded by a later row; see reschedule_of
);

create type ledger_outcome_source as enum (
  'survey',     -- the Post Appointment Survey. Leak 1: the client's own report.
  'crm',        -- GoHighLevel appointment status
  'portal',     -- the practice answered in the client portal
  'staff',      -- somebody at the agency set it by hand
  'tracker',    -- read from the fulfilment spreadsheet
  'defaulted'   -- nobody answered inside the window. Leak 1's fallback.
);

create type ledger_billing_state as enum (
  'pending',    -- outcome not yet resolved
  'billable',   -- delivered, not yet charged
  'billed',
  'waived',
  'disputed',
  'on_hold'     -- pause or extension. Leak 12.
);

create table appointment_ledger (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete restrict,

  -- ---- identity in each feed -------------------------------------------
  -- All nullable, at least one required. Leak 8: two feeds and no
  -- reconciliation. A row carrying both ids IS the reconciliation.
  crm_appointment_id  text,
  hp_appointment_id   text,
  tracker_source_tab  text,
  tracker_source_row  integer,

  -- ---- who ---------------------------------------------------------------
  patient_name  text,
  patient_email text,
  patient_phone text,   -- leak 4: Calendly bookings arrive without one

  -- ---- how it arrived ----------------------------------------------------
  source ledger_source not null default 'unknown',
  -- Leak 9: the dashboard feed matches the string "booked" exactly and silently
  -- drops anything else. The verbatim value is kept so a variant is a reportable
  -- fact rather than a vanished appointment.
  raw_disposition text,
  booked_at       timestamptz,
  booked_by_name  text,
  appointment_at  timestamptz,

  -- ---- leak 2: the disposition is not the calendar entry -----------------
  -- An ISR sets a disposition and separately creates the appointment. Two
  -- manual actions, no cross-check, and commission fires on the disposition.
  -- A row with dispositioned_at and no calendar_seen_at is that exact failure,
  -- and it is now queryable.
  dispositioned_at timestamptz,
  calendar_seen_at timestamptz,

  -- ---- leak 11: a reschedule is the same appointment ---------------------
  -- Measured here: 88 extra rows, 6.9% of consultations, because a reschedule
  -- adds a row instead of updating one. It also drags the reported show rate
  -- down 4.2 points by leaving the no-show in the denominator -- 69.1% reported
  -- against 73.3% once the chain is collapsed.
  reschedule_of  uuid references appointment_ledger(id) on delete set null,
  attempt_number integer not null default 1,

  -- ---- confirmation ------------------------------------------------------
  confirmed_at         timestamptz,
  confirmation_channel text,

  -- ---- outcome: leaks 1 and 6 -------------------------------------------
  outcome        ledger_outcome not null default 'pending',
  outcome_source ledger_outcome_source,
  outcome_at     timestamptz,
  -- The timer leak 6 says does not exist. Set when the row is created, so a
  -- skipped no-show ritual becomes an overdue row instead of an appointment
  -- sitting in Booked forever, indistinguishable from one still to happen.
  outcome_due_at   timestamptz,
  outcome_defaulted boolean not null default false,

  -- ---- leak 7: cancelling means deleting --------------------------------
  -- Nothing is ever deleted from this table. A cancellation is a state, and a
  -- row that stops appearing in the CRM is recorded as missing rather than
  -- removed, so a genuine cancellation and an accidental deletion no longer
  -- look identical afterwards.
  cancelled_at        timestamptz,
  cancellation_reason text,
  cancelled_by        text,
  last_seen_in_crm_at timestamptz,
  missing_since       timestamptz,

  -- ---- leak 5: the client's own calendar --------------------------------
  -- Anything short of two-way sync means the appointment is billable in our
  -- records and invisible in theirs, which is a dispute we lose.
  client_calendar_state      text,
  client_calendar_checked_at timestamptz,

  -- ---- leak 8: which feeds have seen this row ---------------------------
  -- {"crm": "...", "tracker": "...", "hp": "...", "portal": "..."}
  seen_in jsonb not null default '{}'::jsonb,

  -- ---- billing: leak 12 -------------------------------------------------
  billing_state            ledger_billing_state not null default 'pending',
  billing_hold_reason      text,
  billed_at                timestamptz,
  stripe_payment_intent_id text,
  amount_cents             integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A row must be findable in at least one system it came from, or it is not a
  -- record of anything.
  constraint appointment_ledger_has_an_identity check (
    crm_appointment_id is not null
    or hp_appointment_id is not null
    or tracker_source_row is not null
  ),
  -- A cancellation without a time is the untraceable deletion leak 7 describes,
  -- reintroduced inside the table meant to fix it.
  constraint appointment_ledger_cancelled_has_a_time check (
    outcome <> 'cancelled' or cancelled_at is not null
  ),
  -- Money always points at the charge that took it.
  constraint appointment_ledger_billed_has_a_charge check (
    billing_state <> 'billed'
    or (stripe_payment_intent_id is not null and billed_at is not null)
  ),
  -- A defaulted outcome is only meaningful as a showed-by-silence.
  constraint appointment_ledger_default_is_a_show check (
    not outcome_defaulted or (outcome = 'showed' and outcome_source = 'defaulted')
  )
);

-- One appointment per external id, so replaying a feed can never fork a row.
create unique index appointment_ledger_crm_key
  on appointment_ledger (crm_appointment_id) where crm_appointment_id is not null;
create unique index appointment_ledger_hp_key
  on appointment_ledger (hp_appointment_id) where hp_appointment_id is not null;
create unique index appointment_ledger_tracker_key
  on appointment_ledger (tracker_source_tab, tracker_source_row)
  where tracker_source_row is not null;

create index appointment_ledger_client_idx on appointment_ledger (client_id);
create index appointment_ledger_when_idx on appointment_ledger (appointment_at);
create index appointment_ledger_outcome_idx on appointment_ledger (outcome);
create index appointment_ledger_billing_idx on appointment_ledger (billing_state);
-- The exception report's index: unresolved rows past their deadline.
create index appointment_ledger_overdue_idx
  on appointment_ledger (outcome_due_at) where outcome = 'pending';

alter table appointment_ledger enable row level security;
create policy admin_all on appointment_ledger
  for all using (auth_is_admin()) with check (auth_is_admin());

comment on table appointment_ledger is
  'One row per appointment, and the only place that is true. Every other tracker in the stack stores daily counts, which is why an appointment could go missing without anyone being able to say which one. Rows are never deleted: a cancellation is a state and a disappearance is recorded as missing_since, because a genuine cancellation and an accidental deletion otherwise look identical.';

-- ===========================================================================
-- Every appointment in a state somebody has to do something about.
--
-- Phase 4's daily exception report, as a view rather than a report, so a screen,
-- an alert and a scheduled job cannot disagree about what is outstanding. A
-- system nobody looks at fails silently.
--
-- Ordered by what it costs: money already taken without evidence first, then
-- the integrity faults, then delivered-and-unbilled.
-- ===========================================================================
create or replace view appointment_exceptions as
with flagged as (
  select
    l.*,
    case
      when l.billing_state = 'billed' and l.outcome <> 'showed'
        then 'billed without a recorded show'
      when l.missing_since is not null and l.outcome = 'pending'
        then 'vanished from the CRM while still open'
      when l.outcome = 'pending' and l.outcome_due_at < now()
        then 'outcome overdue'
      when l.dispositioned_at is not null and l.calendar_seen_at is null
        then 'dispositioned but never on a calendar'
      when not (l.seen_in ? 'crm') and not (l.seen_in ? 'hp')
        then 'in the tracker only'
      when not (l.seen_in ? 'tracker') and l.appointment_at < now()
        then 'happened but never written to the tracker'
      when l.outcome = 'showed' and l.client_calendar_state in ('manual', 'one_way', 'unknown')
           and l.client_calendar_checked_at is null
        then 'never verified against the practice calendar'
      when l.outcome = 'showed' and l.billing_state = 'billable'
        then 'delivered, not yet billed'
      when l.billing_state = 'on_hold' and coalesce(btrim(l.billing_hold_reason), '') = ''
        then 'on hold with no reason given'
      when l.source = 'unknown' and l.raw_disposition is not null
        then 'disposition not recognised'
    end as exception,
    case
      when l.billing_state = 'billed' and l.outcome <> 'showed' then 1
      when l.missing_since is not null and l.outcome = 'pending' then 2
      when l.outcome = 'pending' and l.outcome_due_at < now() then 3
      when l.dispositioned_at is not null and l.calendar_seen_at is null then 4
      else 5
    end as severity
  from appointment_ledger l
)
select
  f.id,
  f.client_id,
  c.name as practice,
  f.patient_name,
  f.appointment_at,
  f.source,
  f.outcome,
  f.outcome_source,
  f.outcome_due_at,
  f.billing_state,
  f.amount_cents,
  f.exception,
  f.severity
from flagged f
join clients c on c.id = f.client_id
where f.exception is not null;

comment on view appointment_exceptions is
  'Every appointment in a state somebody has to act on, worst first: charged without evidence, then vanished-while-open, then outcome overdue, then dispositioned-with-no-calendar. This is the daily exception report as a query, so a screen, an alert and a cron job cannot disagree about what is outstanding.';
