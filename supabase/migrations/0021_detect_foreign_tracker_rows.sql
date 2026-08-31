-- Bookings that landed in the wrong practice's tracker, evidenced rather than inferred.
--
-- scenario_sheet_findings reads Make's configuration and says a scenario is
-- pointed at the wrong spreadsheet. It cannot say whether that has ever run —
-- Make's execution list will not answer it, and treating an empty execution list
-- as proof was the mistake that produced a false report of 25 lost appointments
-- earlier in this work.
--
-- This looks at the other end. Every row the booking scenario writes carries the
-- GoHighLevel location name into column R, so a row sitting in one practice's
-- sheet while naming a different practice is a write that actually happened.
--
-- WHAT THIS CANNOT SEE, which matters as much as what it can:
--
-- It only detects writes that CREATE a row (addRow). Several of the known
-- misdirected modules are updateRow — they write one cell into an existing row,
-- addressed by a row number computed against a different spreadsheet. Such a
-- write silently overwrites whatever patient happens to occupy that row number
-- in the receiving sheet, and changes no location name. A clean result here is
-- therefore NOT evidence that a practice's sheet is uncorrupted; it is evidence
-- that no foreign booking was appended to it. Detecting the updateRow case needs
-- the spreadsheet's own revision history.
--
-- No heuristic separates the benign entries from the real ones. A first attempt
-- compared the leading word of each name and got both important cases backwards:
-- it called "TMJ Sleep Airway Orthodontics - Gainesville" and "Airway
-- Orthodontics - GNV" different clinics (they are one) and "Kind Dental" and
-- "Kind Dental (General Dentistry)" the same (they are two). Distinguishing two
-- names for one clinic from two clinics is a judgement about the business, not a
-- string comparison, so the view shows the pair and a person reads it.
create view tracker_foreign_rows as
select
  c.id                        as client_id,
  c.name                      as sheet_belongs_to,
  t.location_name             as row_says_it_came_from,
  count(*)                    as rows,
  min(t.booked_for)::date     as earliest,
  max(t.booked_for)::date     as latest
from tracker_appointments t
join clients c on c.id = t.client_id
where t.location_name is not null
  and pps_normalise_practice(t.location_name) <> pps_normalise_practice(c.name)
group by c.id, c.name, t.location_name
order by count(*) desc;

comment on view tracker_foreign_rows is
  'Tracker rows whose GoHighLevel location names a different practice from the sheet they sit in — a misdirected write that demonstrably ran, as opposed to a scenario merely configured to misdirect. Most entries are one clinic under two naming conventions; telling those from a real cross-account write is a judgement, so this view deliberately does not guess. Only detects writes that append a row: a misdirected updateRow overwrites a cell in the receiving sheet without changing any name, so an empty result does NOT mean a sheet is uncorrupted.';
