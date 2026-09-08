-- Map twelve ad accounts to their practices, derived from campaign ids.
--
-- Joshua reconfigured Windsor on 7 September and it now exposes 50 Facebook ad
-- accounts, up from 35. That half worked. What it did not do is tell the Hub
-- which practice each account belongs to, and windsor-ads only asks Windsor for
-- accounts where clients.ad_account_id is set — twenty of eighty clients. The
-- other thirty accounts are never requested, so nothing about them arrives.
--
-- Twelve practices show the consequence exactly. Each has ad spend up to
-- 20 August 2026 and nothing since: their history came from the one-off import
-- of 22 August, which attributed spend by campaign, and the nightly sync cannot
-- reach them because their ad_account_id is null. Eighteen days of a
-- cost-per-booking figure with no cost in it.
--
-- WHY BY CAMPAIGN AND NOT BY NAME
--
-- Because the names are wrong, and would have misattributed money.
--
-- Each of these practices has exactly one campaign in the Hub, carrying the
-- external id Meta gave it. Asking Windsor which account owns that campaign is
-- a join on a unique id, and the answers do not resemble the practices:
--
--   the account called "Hales Parker Dentistry" belongs to The Dental Collective
--   the account called "SmilesWestTexas"        belongs to Hancock and Johnston
--   the account called "Elena Dana Marcarian"   belongs to Magic Dental
--   the account called "Beta"                   belongs to Andros Orthodontics
--   the account called "2019210581"             belongs to Cruz Orthodontics
--
-- A name-matched mapping would have put five practices' spend on the wrong
-- clients and looked plausible doing it. Worth stating because a sheet of ad
-- account names was being prepared for exactly this purpose; it should be
-- checked against campaign ids before anyone trusts it.
--
-- CHECKED BEFORE WRITING
--
-- Every campaign Windsor holds in these twelve accounts was looked up in the
-- Hub. Each account resolves to exactly one practice — no account is shared, so
-- attributing a whole account to one practice cannot take another's spend.
-- Accounts hold campaigns the Hub has never seen, which is expected: the Hub
-- knows the campaign that was running when the tracker was imported.
--
-- WHAT THIS DOES NOT FIX
--
-- Seven accounts with spend in the last 30 days still belong to no practice,
-- about $2,906, and one of them matters more than its spend: "Ad Account 13"
-- (1522430326001923) reported 119 of the fleet's 157 leads on $526. Nobody can
-- map those from data — they have no campaign the Hub has ever seen — so they
-- need somebody who knows the accounts.
--
-- Nor does it fix leads. Meta still reports zero for 35 of the 39 accounts that
-- spent anything in the last 30 days. That is conversion tracking, untouched by
-- the Windsor reconfiguration.

update clients set ad_account_id = '3267173910102547'  where name = 'Andros Orthodontics'                       and ad_account_id is null;
update clients set ad_account_id = '655516055301657'   where name = 'The Dental Collective'                     and ad_account_id is null;
update clients set ad_account_id = '270725855039085'   where name = 'Singleton Smile Dental'                    and ad_account_id is null;
update clients set ad_account_id = '25984815481156126' where name = 'Tamara Levit DDS PC'                       and ad_account_id is null;
update clients set ad_account_id = '832814773861221'   where name = 'Hancock and Johnston Dentistry'            and ad_account_id is null;
update clients set ad_account_id = '1200389502206899'  where name = 'Smile and Implant Center of Rockland'      and ad_account_id is null;
update clients set ad_account_id = '2190253088404001'  where name = 'Genuine Family Dentistry'                  and ad_account_id is null;
update clients set ad_account_id = '569740232443261'   where name = 'Wilmington Family Dental'                  and ad_account_id is null;
update clients set ad_account_id = '1104523434966094'  where name = 'Cruz Orthodontics'                         and ad_account_id is null;
update clients set ad_account_id = '914912008083810'   where name = 'Magic Dental'                              and ad_account_id is null;
update clients set ad_account_id = '4379973445580398'  where name = 'The Smile Lounge'                          and ad_account_id is null;
update clients set ad_account_id = '1364841078777057'  where name = 'TMJ Sleep Airway Orthodontics - Williston' and ad_account_id is null;

/*
 * Assert rather than hope.
 *
 * `where ad_account_id is null` makes this safe to re-run and stops it
 * overwriting a mapping somebody has since corrected by hand — but it also
 * means a practice renamed in the meantime would be skipped silently, leaving
 * the sync still unable to reach it. So the count is checked, and one id
 * appearing twice is checked too, because that is what a copy-paste error in
 * the list above looks like.
 */
do $$
declare
  mapped   integer;
  repeated integer;
begin
  select count(*) into mapped
  from clients
  where ad_account_id in (
    '3267173910102547','655516055301657','270725855039085','25984815481156126',
    '832814773861221','1200389502206899','2190253088404001','569740232443261',
    '1104523434966094','914912008083810','4379973445580398','1364841078777057'
  );

  if mapped <> 12 then
    raise exception
      'Expected 12 practices mapped, found %. A practice was probably renamed; '
      'match it by its campaign external_id in the campaigns table rather than '
      'by name, and check no account was assigned to two clients.', mapped;
  end if;

  select count(*) into repeated
  from (
    select ad_account_id from clients
    where ad_account_id is not null
    group by ad_account_id having count(*) > 1
  ) duplicated;

  if repeated <> 0 then
    raise exception
      '% ad account(s) are mapped to more than one practice. Windsor reports '
      'one account per practice, so this would split or double somebody''s '
      'spend.', repeated;
  end if;
end
$$;
