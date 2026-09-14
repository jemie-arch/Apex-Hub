/*
 * Scope the sheet-coverage report the way Joshua scoped it.
 *
 * Two corrections from him on 14 September, both right, and the first one
 * corrects a number I had already sent him.
 *
 * "lime stone, metro dental are clinics that churned ... we should only count
 * ones that have tracking sheets in that folder"
 *
 * Limestone Hills and Metro Dental appeared in the report with 55 and 46
 * appointments "missing", which read as neglect. They are churned practices
 * with no tracking sheet to be missing from. pps_clinic_routing already knows
 * which practices have a sheet - it maps practice to spreadsheet id and is what
 * the PPS scenarios route on - and it confirms him independently: neither has a
 * row, while Bespoke, City Dental and Ultra Smiles all do. So the report is now
 * an inner join on it. 49 practices, not 55.
 *
 * Note what this does NOT lean on. clients.is_active still says both are
 * active, so churn is not recorded where the Hub would notice it. Routing
 * membership is the honest signal available today; the stale is_active flags
 * are a separate problem and worth fixing at source.
 *
 * "city dental missing 173... likely incorrect"
 *
 * Also right, and for a reason I had not checked. Of City Dental's 176, one
 * hundred and thirty seven carry NO PATIENT NAME. Fleet-wide 626 of 1,420 are
 * nameless. They are real CRM records - every one has a crm_appointment_id and
 * a booked_at - but an appointment with no patient on it is not something
 * anybody can go and type into a tracking sheet, and presenting it as a
 * shortfall the team should close was wrong.
 *
 * So missing is split rather than filtered. missing_named is the worklist:
 * appointments somebody could actually add. missing_unnamed is kept beside it
 * because 626 thin records are themselves a finding about the CRM sync, and
 * dropping them silently would bury it.
 *
 * Scoped and split, the fleet reads 685 addable appointments rather than 1,420.
 * Coverage is computed against named appointments only, for the same reason.
 */
drop view if exists public.v_cft_sheet_coverage;

create view public.v_cft_sheet_coverage
with (security_invoker = on) as
  with routed as (
    select distinct client_id
    from pps_clinic_routing
    where client_id is not null
  ), sheet as (
    select client_id, count(*) as in_sheet
    from tracker_appointments
    where client_id is not null
    group by client_id
  ), ghl as (
    select
      client_id,
      count(*) filter (
        where patient_name is not null and trim(patient_name) <> ''
      ) as missing_named,
      count(*) filter (
        where patient_name is null or trim(patient_name) = ''
      ) as missing_unnamed
    from appointment_ledger
    where client_id is not null
      and tracker_source_row is null
      and appointment_at is not null
    group by client_id
  )
  select
    c.id                                   as client_id,
    c.name                                 as client_name,
    c.group_id,
    c.is_active,
    coalesce(s.in_sheet, 0)                as in_sheet,
    coalesce(g.missing_named, 0)           as missing_named,
    coalesce(g.missing_unnamed, 0)         as missing_unnamed,
    coalesce(s.in_sheet, 0) + coalesce(g.missing_named, 0) as true_total,
    case
      when coalesce(s.in_sheet, 0) + coalesce(g.missing_named, 0) = 0 then null
      else coalesce(s.in_sheet, 0)::numeric
           / (coalesce(s.in_sheet, 0) + coalesce(g.missing_named, 0))
    end                                    as coverage
  from routed r
  join clients c on c.id = r.client_id
  left join sheet s on s.client_id = c.id
  left join ghl   g on g.client_id = c.id
  where not c.is_internal
    and coalesce(s.in_sheet, 0) + coalesce(g.missing_named, 0) > 0;

comment on view public.v_cft_sheet_coverage is
  'Appointments in GoHighLevel but not the tracker sheet, for practices that HAVE a tracking sheet (pps_clinic_routing). Named and unnamed counted separately - only named ones can be added by hand.';
