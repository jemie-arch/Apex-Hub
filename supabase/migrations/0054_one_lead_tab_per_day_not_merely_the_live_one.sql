-- One lead tab per day, not merely "not the newest".
--
-- 0051's rule preferred the live tab over the older ones: a row counted if it
-- came from "Leads Data", or if no "Leads Data" row existed for that
-- (practice, day). That is correct about the live tab and silent about the
-- others — so for every day the live tab did not cover, BOTH older tabs
-- counted, and they hold near-identical data.
--
-- The first week of August read 732 leads and a $17.34 cost per lead. Halved,
-- 368 and $34.17, which is where the four weeks either side of it sit. The
-- doubling was the two old tabs counting each other.
--
-- Ranking rather than excluding is the fix: for each (practice, day) take rows
-- from the single highest-preference tab that has any, and ignore the rest.
-- "Not the newest" is not the same instruction as "exactly one".
--
-- Still positional, and still deliberately not a match on name and date:
-- deciding which rows are the same person from a hand-typed name column would
-- be a guess, and a guess here changes what a practice is billed against.

create or replace view v_tracker_leads_effective
with (security_invoker = on) as
  with ranked as (
    select
      l.*,
      dense_rank() over (
        partition by l.client_id, l.received_on
        order by case l.source_tab
                   when 'Leads Data'      then 1
                   when 'Leads Data Old'  then 2
                   when 'Lead Count Old'  then 3
                   else 4
                 end,
                 -- Tie-broken by name, so an unknown tab added later is
                 -- deterministic rather than whichever Postgres reached first.
                 l.source_tab
      ) as tab_rank
    from tracker_leads l
  )
  select
    id, source_row, company_name, client_id, received_on, lead_name,
    lead_count, campaign_external_id, campaign_name, adset_external_id,
    adset_name, ad_external_id, ad_name, imported_at, source_tab
  from ranked
  where tab_rank = 1;

comment on view v_tracker_leads_effective is
  'tracker_leads reduced to exactly ONE tab per (practice, day), by preference: '
  'Leads Data, then Leads Data Old, then Lead Count Old. '
  'The first version only preferred the live tab over the older ones, which left '
  'the two OLDER tabs counting each other for every day the live tab was silent '
  'about — and they hold near-identical data, so the first week of August read '
  '732 leads and a $17 cost per lead against a true figure near half that. '
  'Ranking rather than excluding is what makes it one tab and not "not the '
  'newest". Positional on purpose: matching leads to each other by name and '
  'date would be a guess about which rows are the same person, on a column '
  'typed by hand.';
