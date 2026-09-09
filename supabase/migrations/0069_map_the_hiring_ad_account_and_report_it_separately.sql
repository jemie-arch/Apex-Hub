-- Ad Account 13 is recruitment, not a practice.
--
-- 1522430326001923 reported 119 of the fleet's 157 leads on $526 and could not
-- be mapped from data — it runs campaigns the Hub has never seen. Migration
-- 0047 left it unmapped and said it needed somebody who knows the accounts.
-- Joshua does: it is the hiring ads.
--
-- The economics corroborate it without needing anyone's word. $526 for 119
-- leads is $4.42 each. Dental patient leads on this fleet run $40 to $108. A
-- figure an order of magnitude below the rest is a different product, and that
-- product is job applicants.
--
-- WHY IT MATTERS BEYOND TIDINESS: those 119 leads were three quarters of the
-- fleet's reported lead volume. Left unmapped they sat outside every practice's
-- numbers, which was accidentally the right answer. Mapped to a PRACTICE they
-- would have been catastrophically wrong — a recruitment lead is not a patient,
-- and $4.42 blended into a practice's cost per lead makes its marketing look
-- twice as effective as it is.
--
-- So it is attached to an INTERNAL client, and 0068 is what makes that safe:
-- internal clients no longer reach the Client Fulfilment Tracker at all. The
-- spend becomes visible and attributable without ever touching a client figure.
--
-- THE ASSUMPTION, stated because it is one: the only active internal account
-- with "Hiring" in its name is "Singleton Smile [Hiring Account]", a real
-- GoHighLevel sub-account carrying no leads and no campaigns. Joshua said
-- "hiring ads" without naming an entity. If this is agency-wide recruitment
-- rather than Singleton's specifically, the fix is to move one column to a
-- different internal client — nothing else depends on the choice.

update clients
set ad_account_id = '1522430326001923'
where name = 'Singleton Smile [Hiring Account]'
  and is_internal
  and ad_account_id is null;

/* Assert rather than hope, the same way 0047 does. */
do $$
declare mapped integer;
begin
  select count(*) into mapped
  from clients where ad_account_id = '1522430326001923';

  if mapped <> 1 then
    raise exception
      'Expected exactly one client mapped to the hiring ad account, found %.',
      mapped;
  end if;
end
$$;

-- Recruitment ad performance, reported on its own terms.
--
-- Joshua asked for campaign name, cost per lead and amount spent. Those are the
-- three columns. It reads the same insight tables the client tracker reads, but
-- scoped to internal accounts — so recruitment gets a real report instead of
-- being an unexplained gap in the fleet totals.
--
-- Expect this to be EMPTY until the next Windsor sync. Campaigns are ingested
-- per mapped client and this account had no mapping until the statement above,
-- so the Hub holds none of its campaigns yet. Empty tomorrow morning would mean
-- something is wrong; empty now is expected.

create or replace view v_recruitment_ads as
  select
    cl.id                                              as client_id,
    cl.name                                            as account_name,
    cl.ad_account_id,
    cmp.name                                           as campaign_name,
    cmp.external_id                                    as campaign_id,
    min(i.insight_on)                                  as first_day,
    max(i.insight_on)                                  as last_day,
    round(sum(i.spend_cents) / 100.0, 2)               as spend,
    sum(i.impressions)                                 as impressions,
    sum(i.clicks)                                      as clicks,
    sum(i.leads)                                       as leads,
    /*
     * Blank rather than zero when no spend is recorded, matching the rule the
     * client tracker follows: a cost per lead of nothing is a claim, not a
     * measurement.
     */
    case
      when sum(i.spend_cents) > 0 and sum(i.leads) > 0
      then round((sum(i.spend_cents) / 100.0) / sum(i.leads), 2)
    end                                                as cost_per_lead
  from clients cl
  join campaigns cmp on cmp.client_id = cl.id
  left join ad_level_insights i on i.campaign_id = cmp.id
  where cl.is_internal
  group by cl.id, cl.name, cl.ad_account_id, cmp.name, cmp.external_id;

comment on view v_recruitment_ads is
  'Ad performance for internal accounts — recruitment and ADM''s own spend — '
  'reported separately because it is not client fulfilment. Campaign name, '
  'spend and cost per lead, which is what was asked for. These accounts are '
  'excluded from v_cft_stats_dashboard on purpose: at $4.42 a lead, blending '
  'hiring ads into a practice''s cost per lead would make its marketing look '
  'twice as good as it is.';
