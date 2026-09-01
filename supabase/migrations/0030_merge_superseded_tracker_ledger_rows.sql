-- Let a tracker row become a CRM row without colliding with itself.
--
-- rebuild_appointment_ledger() builds the ledger from two feeds. Step 1 inserts
-- one row per CRM appointment. Step 2 matches tracker rows to those on client +
-- patient name + date and stamps the tracker key onto the matched CRM row:
--
--   update appointment_ledger l
--   set tracker_source_tab = p.tab, tracker_source_row = p.source_row, ...
--
-- What it never does is remove the row it is superseding. A tracker row that
-- has been arriving on its own for months already owns a tracker-only ledger
-- row; the moment a CRM appointment matches it, two rows carry the same
-- (tracker_source_tab, tracker_source_row) and appointment_ledger_tracker_key
-- rejects the update. The function is one statement, so three colliding rows
-- abort the entire rebuild and every reconciliation number goes stale.
--
-- The fault was dormant from the day the ledger was built, because it needs a
-- practice to cross from "tracker rows, no CRM appointments" to "both", and no
-- practice ever had. Kind Dental crossed it on 1 Sep 2026, when the calendar its
-- consultations are booked on stopped being excluded from the sync. Village
-- Dental will cross it the moment its own missing calendar is found.
--
-- Fixed here rather than inside rebuild_appointment_ledger, deliberately. The
-- superseded rows can be identified without any of that function's internals —
-- they are tracker-only ledger rows whose patient and date already exist as a
-- real appointment — so this runs first, as its own reviewable step, and leaves
-- 177 lines of billing logic untouched.
--
-- It matches `appointments` rather than CRM-keyed ledger rows on purpose: at the
-- point this runs, the ledger rows for those appointments do not exist yet. Step
-- 1 of the rebuild is what creates them.
--
-- Losing the superseded row loses nothing durable. attribute_ledger_charges()
-- resets billing_state, billed_at, stripe_payment_intent_id and amount_cents on
-- every 'billed' and 'billable' row at the start of each run and re-derives them
-- from billing_charges. The three states it does NOT recompute -- waived,
-- disputed, on_hold -- are a human's decision, so a row holding one is left
-- alone. If that ever collides the rebuild will abort exactly as it does today,
-- which is the right outcome: somebody disputed that charge and a merge should
-- not quietly decide what happens to it.
create or replace function merge_superseded_tracker_ledger_rows()
returns integer
language plpgsql
as $fn$
declare
  removed integer;
begin
  delete from appointment_ledger dup
  using tracker_appointments t, appointments a
  where dup.tracker_source_tab = 'Appointment Data'
    and dup.tracker_source_row = t.source_row
    and dup.crm_appointment_id is null
    and t.client_id is not null
    and a.client_id = t.client_id
    and a.crm_appointment_id is not null
    and lower(btrim(a.patient_name)) = lower(btrim(t.patient_name))
    and (a.scheduled_at at time zone 'UTC')::date = t.booked_for
    and dup.billing_state not in ('waived', 'disputed', 'on_hold');

  get diagnostics removed = row_count;
  return removed;
end;
$fn$;

comment on function merge_superseded_tracker_ledger_rows is
  'Remove tracker-only ledger rows that a CRM appointment has caught up with, so rebuild_appointment_ledger can stamp the tracker key onto the CRM row without violating appointment_ledger_tracker_key. Must run before the rebuild, and matches the appointments table rather than the ledger because the CRM ledger rows do not exist until the rebuild creates them. Rows in waived, disputed or on_hold are left alone: those states are not re-derived from billing_charges, so merging one away would silently discard a decision somebody made. Returns how many rows it removed.';
