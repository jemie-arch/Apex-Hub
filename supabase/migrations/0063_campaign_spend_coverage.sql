-- Is a practice's cost per lead trustworthy? Almost never at campaign grain.
--
-- Joshua reported that Singleton Smile Dental and Village Dental "have
-- mismatches in both spend and bookings" and that CPL was not showing. Both are
-- real. Neither is a calculation error, and neither is missing campaigns.
--
-- THE TRACKER SHEET'S CAMPAIGN ID IS NOT RELIABLE PER ROW.
--
--   Singleton Smile Dental has 97 lead rows citing 16 DISTINCT campaign ids.
--   Fifteen of those campaigns belong to other practices.
--
--   Fleet-wide it is worse and completely symmetrical: every campaign id is
--   cited by leads from 3 to 29 different practices. The campaign literally
--   named "Apex | Singleton Smile Dental | $3789 for Invisalign All In" is
--   cited by leads from 29 practices. There are ~35 practices in total, so
--   nearly every practice cites nearly every campaign.
--
-- That is the shape of a cross join, not a mapping slip, and it is present in
-- tracker_leads itself — so it arrives from the sheet rather than being
-- introduced here.
--
-- An earlier version of this migration blamed missing campaign records and a
-- spend/lead window mismatch. Both were wrong. 35 of the 37 supposedly missing
-- campaign ids exist in the campaigns table perfectly well; they are attached
-- to a different client, so this view's join on (client_id, external_id) drops
-- them. The join is right and the data feeding it is wrong.
--
-- WHAT THIS MEANS FOR THE NUMBERS
--
--   Campaign-grain CPL is meaningless until the sheet is fixed. Not imprecise —
--   meaningless, because the leads on a campaign row mostly are not that
--   campaign's leads.
--
--   Client-grain CPL is sound. Leads attach to the right practice and spend
--   attaches to the right practice; only the campaign attribution between them
--   is corrupt. This is the number to quote.
--
-- So the columns below are a trust measure, and their names are kinder than
-- the truth: "campaigns_missing" counts campaign ids this practice's leads
-- cite that are not this practice's campaign, and "leads_uncovered" counts
-- the leads doing the citing. coverage near 1.00 would mean the sheet was
-- filled in carefully for that practice. Nobody is near 1.00.

create or replace view v_cft_campaign_spend_coverage
with (security_invoker = on) as
  select
    client_id,
    client_name,
    count(distinct campaign_id_external)
      filter (where campaign_uuid is not null)                as campaigns_in_hub,
    count(distinct campaign_id_external)
      filter (where campaign_uuid is null
                and campaign_id_external is not null)         as campaigns_missing,
    sum(leads_best)                                           as leads,
    sum(leads_best) filter (where campaign_uuid is not null)   as leads_covered,
    sum(leads_best) filter (where campaign_uuid is null)       as leads_uncovered,
    round(
      sum(leads_best) filter (where campaign_uuid is not null)::numeric
      / nullif(sum(leads_best), 0),
      3
    )                                                          as coverage,
    round(sum(spend_cents) / 100.0, 2)                         as spend,
    /*
     * CPL two ways, and cpl_all_leads is the one to trust — it is the practice's
     * own spend over the practice's own leads, both of which attach correctly.
     *
     * cpl_covered_leads divides by only the leads citing this practice's own
     * campaign. That sounds tighter and is not: the same scatter that sends this
     * practice's leads onto other campaigns sends other practices' leads onto
     * this one, so the "covered" subset is neither complete nor exclusively
     * this practice's. It is kept only to show the size of the divergence.
     */
    round((sum(spend_cents) / 100.0)
          / nullif(sum(leads_best), 0), 2)                     as cpl_all_leads,
    round((sum(spend_cents) / 100.0)
          / nullif(sum(leads_best) filter (where campaign_uuid is not null), 0), 2)
                                                               as cpl_covered_leads,
    min(day) filter (where spend_cents > 0)                    as first_spend_day,
    min(day) filter (where leads_best > 0)                     as first_lead_day
  from v_cft_stats_dashboard
  group by client_id, client_name;

comment on view v_cft_campaign_spend_coverage is
  'Per practice: how many of its campaigns the Hub actually holds spend for, and '
  'what share of its leads those cover. coverage below 1.00 means the dashboard '
  'CPL is understated, because leads from campaigns with no recorded spend still '
  'sit in the denominator; cpl_covered_leads is the better estimate. '
  'ROOT CAUSE: the Hub holds 38 campaigns for 35 clients — 32 clients have '
  'exactly one — while the tracker sheet names 75 distinct campaign ids. So most '
  'campaigns are simply not ingested, and their spend is missing entirely. A '
  'window mismatch (spend from 15 July 2026, leads from 25 December 2025) is a '
  'secondary contributor and does not explain practices like Singleton Smile '
  'Dental, whose leads all fall inside the spend window and which still shows '
  '25 campaigns missing.';
