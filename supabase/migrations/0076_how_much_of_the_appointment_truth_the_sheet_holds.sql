/*
 * The tracker sheet holds 47.3% of the appointments.
 *
 * Joshua: "The appts in GHL are more accurate than the ones in the sheet."
 * Measured, he is right, and by more than anyone assumed. GoHighLevel carries
 * 2,693 appointments; the sheet carries 1,273 of them. 1,420 exist only in the
 * CRM, and SIX practices have nothing in the sheet at all - Limestone Hills has
 * 0 of 55, Metro Dental 0 of 46.
 *
 * The relationship is one-directional. Not one practice has an appointment in
 * the sheet that the CRM lacks, so the sheet is a strict subset rather than a
 * disagreeing second opinion. That matters for the fix: nothing in the sheet
 * needs correcting, things need ADDING.
 *
 * Why this view rather than a one-off query: the Hub reads the tracker sheet
 * read-only and always will - the Google scope is spreadsheets.readonly on
 * purpose, so a bug here can never scribble on the thing everybody trusts. The
 * Hub therefore cannot fix the sheet. What it can do is say exactly how far off
 * each practice is, so whoever maintains it knows where to start and can tell
 * when they are done.
 *
 * It also explains a number that would otherwise look wrong. Schedule % divides
 * sheet appointments by sheet leads: consistent, but both sides undercounted.
 * Until the sheet is filled in, that column reports the sheet's view of the
 * world rather than the world.
 */
create or replace view public.v_cft_sheet_coverage
with (security_invoker = on) as
  with sheet as (
    select client_id, count(*) as in_sheet
    from tracker_appointments
    where client_id is not null
    group by client_id
  ), ghl as (
    select client_id, count(*) as missing_from_sheet
    from appointment_ledger
    where client_id is not null
      and tracker_source_row is null
      and appointment_at is not null
    group by client_id
  )
  select
    c.id                                        as client_id,
    c.name                                      as client_name,
    c.group_id,
    c.is_active,
    coalesce(s.in_sheet, 0)                     as in_sheet,
    coalesce(g.missing_from_sheet, 0)           as missing_from_sheet,
    coalesce(s.in_sheet, 0) + coalesce(g.missing_from_sheet, 0) as true_total,
    case
      when coalesce(s.in_sheet, 0) + coalesce(g.missing_from_sheet, 0) = 0 then null
      else coalesce(s.in_sheet, 0)::numeric
           / (coalesce(s.in_sheet, 0) + coalesce(g.missing_from_sheet, 0))
    end                                         as coverage
  from clients c
  left join sheet s on s.client_id = c.id
  left join ghl   g on g.client_id = c.id
  where not c.is_internal
    and coalesce(s.in_sheet, 0) + coalesce(g.missing_from_sheet, 0) > 0;

comment on view public.v_cft_sheet_coverage is
  'How many appointments the tracker sheet holds against what GoHighLevel knows. The sheet is a strict subset - no practice has an appointment the CRM lacks.';
