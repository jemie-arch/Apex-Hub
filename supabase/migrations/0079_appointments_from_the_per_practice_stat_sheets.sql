/*
 * Appointments as the per-practice stat sheets record them.
 *
 * Every practice has its own stat sheet. Their ids are already in
 * pps_clinic_routing, verified in September by reading the Location ID column
 * out of each live sheet and matching it to crm_location_id — an id-to-id
 * match, not a name comparison. So the set of sheets to read is known and
 * checked, and no Drive folder listing is needed: the Hub's Google scope is
 * spreadsheets.readonly, which reads a sheet by id and cannot list a folder.
 *
 * WHY A SEPARATE TABLE rather than writing into appointments.
 *
 * This is a third account of the same events, and the first two already
 * disagree — tracker_appointments has 1,273 rows, appointment_ledger has 1,420
 * the tracker has never seen. Merging a third into either would destroy the
 * ability to say which source said what, which is the only way the
 * disagreements have ever been resolved. It lands whole, and reconciliation is
 * a separate decision made once the shape is visible.
 *
 * THE AD COLUMNS ARE NAMED FOR WHERE THEY COME FROM, NOT FOR THEIR LABELS.
 *
 * The sheet heads them Campaign ID, Ad Set ID, Ad ID and Ad Name. The PPS Make
 * scenarios that write them fill those cells from GoHighLevel's
 * contact.attributionSource: utmTerm, utmMedium and lastAttributionSource.
 * utmContent. Two of the four are fed from the identical field.
 *
 * So a cell labelled "Ad ID" contains whatever utm_content held, which is a
 * real Meta ad id only if the campaigns were built to put one there. Nobody has
 * checked. Storing them as utm_* keeps that honest: if they do turn out to
 * carry ad ids, this is the missing link between a booking and the creative
 * that produced it, and renaming a column later is cheap. Believing a label
 * that lies is not.
 */
create table if not exists public.stat_sheet_appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  spreadsheet_id text not null,
  /* The row it came from, so a re-read updates rather than duplicates. */
  source_row integer not null,

  /* GoHighLevel's own appointment id, where the sheet carries one. */
  appointment_external_id text,

  patient_name text,
  patient_email text,
  patient_phone text,

  date_added date,
  appointment_on date,
  appointment_at timestamptz,
  booked_on date,

  cc_on_file text,
  confirmed text,
  first_consultation_show text,
  second_consultation_show text,
  converted_to_patient text,
  credit_plan_approved text,
  charged text,

  lead_source text,
  offer_name text,
  notes text,

  location_name text,
  location_external_id text,

  /*
   * Named for their source, not the sheet's labels. See the header.
   */
  utm_campaign text,
  utm_term text,
  utm_medium text,
  utm_content text,

  synced_at timestamptz not null default now(),

  unique (client_id, spreadsheet_id, source_row)
);

create index if not exists stat_sheet_appointments_client_idx
  on public.stat_sheet_appointments (client_id, appointment_on);

create index if not exists stat_sheet_appointments_external_idx
  on public.stat_sheet_appointments (appointment_external_id)
  where appointment_external_id is not null;

alter table public.stat_sheet_appointments enable row level security;

/* Service-role only, like every other sync target. */

comment on table public.stat_sheet_appointments is
  'Appointments as each practice stat sheet records them. A third account alongside tracker_appointments and appointment_ledger, kept separate so the three can be compared. utm_* columns are the sheet''s Campaign/Ad Set/Ad ID columns, which are populated from GoHighLevel UTM fields rather than Meta object ids - see migration 0079.';
