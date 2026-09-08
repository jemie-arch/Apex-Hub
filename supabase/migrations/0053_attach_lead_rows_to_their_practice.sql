-- Attach lead rows to their practice. Nothing ever did.
--
-- tracker_leads.client_id was filled once, by the hand import of 22 August,
-- and no code has set it since. apply_tracker_aliases() only touches
-- tracker_appointments. fulfilment-leads leaves it null on purpose, with a
-- comment saying tracker_practice_aliases owns the matching — which was true
-- of the alias TABLE and false of anything applying it to this table.
--
-- WHAT THAT COST, IMMEDIATELY
--
-- Every count of sheet leads filters on client_id, because a lead attached to
-- no practice belongs to nobody. So re-importing the tab produced rows nothing
-- would count, and the cost per lead went the wrong way in front of me:
--
--   week of 24 Aug   217 leads -> 20    CPL $35.59 -> $386.15
--   week of 31 Aug   255 leads -> 17    CPL $34.68 -> $520.25
--
-- The leads were in the table the whole time. 634 of 1,121 rows on the live
-- tab had no practice, and 2,870 of the 3,486 rows recovered from the older
-- tabs had none either — including rows whose company_name is exactly a
-- client's name, which is what makes this a missing step rather than a naming
-- problem.
--
-- FILLS NULLS ONLY
--
-- So it is safe to run after every import and can never undo a correction
-- somebody made by hand. Same contract as apply_tracker_aliases.

create or replace function apply_tracker_lead_aliases()
returns integer
language plpgsql
as $fn$
declare
  by_alias integer;
  by_name  integer;
begin
  /*
   * Aliases first, because they are somebody's decision and must beat a
   * name that merely looks similar. Six rows today, each with a note saying
   * how it was confirmed.
   */
  update tracker_leads l
  set client_id = a.client_id
  from tracker_practice_aliases a
  where l.client_id is null
    and l.company_name = a.tracker_name;
  get diagnostics by_alias = row_count;

  /*
   * Then an exact match once normalised — case, punctuation and spacing only.
   * NOT a fuzzy match: putting one practice's leads onto another's numbers is
   * worse than leaving them unattached, and an unattached lead is already
   * visible in tracker_unmatched_lead_names below.
   *
   * The `= 1` guard is the part that matters. Two clients whose names
   * normalise to the same string would otherwise both match, and the update
   * would attach the lead to whichever Postgres reached first — silently, and
   * differently on a re-run.
   */
  update tracker_leads l
  set client_id = c.id
  from clients c
  where l.client_id is null
    and l.company_name is not null
    and pps_normalise_practice(c.name) = pps_normalise_practice(l.company_name)
    and (
      select count(*) from clients other
      where pps_normalise_practice(other.name)
            = pps_normalise_practice(l.company_name)
    ) = 1;
  get diagnostics by_name = row_count;

  return by_alias + by_name;
end;
$fn$;

comment on function apply_tracker_lead_aliases is
  'Attach tracker_leads rows to clients: aliases first, then an exact match on '
  'the normalised practice name, and only where exactly one client matches. '
  'Fills nulls only, so it is safe after every import and never undoes a hand '
  'correction. Returns how many rows it attached. tracker_leads.client_id had '
  'no code setting it at all before this — the counts that filter on it were '
  'quietly dropping every row the hand import of 22 August had not already '
  'matched.';

-- The queue for the names it could not place, mirroring
-- tracker_unmatched_names on the appointments side.
create or replace view tracker_unmatched_lead_names
with (security_invoker = on) as
select
  l.company_name,
  l.source_tab,
  count(*)                as rows,
  min(l.received_on)      as earliest,
  max(l.received_on)      as latest,
  exists (
    select 1 from clients c
    where pps_normalise_practice(c.name) = pps_normalise_practice(l.company_name)
  ) as a_client_of_that_name_exists
from tracker_leads l
where l.client_id is null
  and l.company_name is not null
group by l.company_name, l.source_tab
order by count(*) desc;

comment on view tracker_unmatched_lead_names is
  'Lead rows attached to no client, by the spelling the sheet used and the tab '
  'it came from. Every one of these is excluded from every lead count, so this '
  'is the queue that decides whether a cost per lead is right. '
  'a_client_of_that_name_exists separates a spelling problem, which an alias '
  'fixes, from a practice that is genuinely not in the CRM — where guessing '
  'would put somebody else''s leads on a real practice''s numbers.';

-- Run it now, on the rows already imported.
do $$
declare
  attached integer;
  remaining integer;
begin
  attached := apply_tracker_lead_aliases();

  select count(*) into remaining
  from tracker_leads where client_id is null;

  raise notice 'Attached % lead row(s) to a practice; % still unattached.',
    attached, remaining;
end
$$;
