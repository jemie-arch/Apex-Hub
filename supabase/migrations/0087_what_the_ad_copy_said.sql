/*
 * What the ad copy said, when the account names did not.
 *
 * Four accounts in Business Manager belonged to nobody by name. Reading the
 * body text of every ad Windsor returned for them over a year answered three:
 *
 *   NYO  1358157841061189
 *     "Hey Vacaville! ... FREE Consultation with Board Certified Orthodontist,
 *      Dr. Natalie Yang" -> Natalie Yang Orthodontics. $11.3k in the year,
 *      $1.9k in the last 65 days. Live, and until now unattributed.
 *
 *   Buena Park Dental Center  875564064558385
 *     "Dr. Zakhary has 2 locations to serve you best! Buena Park Dental Center,
 *      Anaheim Smile Center" -> the second door of Anaheim Smile Center, which
 *      is the Hub client. Owner is Anaheim; there is no Buena Park client to
 *      give it to. No spend in the last 65 days.
 *
 *   AC - Select Dental Implants  931280679431754
 *     "Dr. Pourshirazi and the team at Diamond Dental" -> already Diamond
 *      Dental's from 0085. The account name is the implant brand of the same
 *      practice. Nothing to change; recorded so nobody re-opens it.
 *
 *   Stephen Tran, DDS  1108321215187777  -> no ad in 365 days. Left alone.
 *
 * The same reading found that one mapped account was mapped to the wrong kind
 * of thing. "All Dental of Menifee (Apex)" ran only hiring campaigns all year:
 * ISR Hiring, MB Hiring, Appt Setter Hiring, Actor Hiring, $5.5k. It is an
 * Apex recruitment account that happens to carry a practice's name. 0084 gave
 * it to the practice; that would have put recruiting spend on a client's
 * tracker. The hiring client owns it now and the practice stays linked.
 *
 * And it found campaigns living in the wrong account entirely, which
 * windsor-ads now handles by consulting campaign_practice_map before the
 * account owner. The rows below feed that: two Team Dental campaigns and two
 * Smile Orthodontics campaigns in other practices' accounts, and three
 * practices that are not Hub clients at all, whose rows must not land on the
 * owner. For those, client_id resolves to null unless a client by that name
 * exists, and windsor-ads drops the rows rather than guess.
 */

/* Natalie Yang Orthodontics owns NYO. */
insert into public.client_ad_accounts (client_id, ad_account_id, account_name, owns_spend, note)
select c.id, '1358157841061189', 'NYO', true,
       'Identified from ad copy ("Dr. Natalie Yang", Vacaville), 15 Sep 2026. Five campaigns, none on Joshua''s list.'
from public.clients c where c.name = 'Natalie Yang Orthodontics'
on conflict (client_id, ad_account_id) do nothing;

/* Buena Park is Anaheim Smile Center's second location. */
insert into public.client_ad_accounts (client_id, ad_account_id, account_name, owns_spend, note)
select c.id, '875564064558385', 'Buena Park Dental Center', true,
       'Dr. Zakhary''s second location per the ad copy; Anaheim Smile Center is the Hub client. Same offer as Anaheim''s campaign. No spend in the 65 days to 15 Sep 2026.'
from public.clients c where c.name = 'Anaheim Smile Center'
on conflict (client_id, ad_account_id) do nothing;

/* The Menifee account is a hiring account. */
update public.client_ad_accounts a
set owns_spend = false,
    note = 'Named for the practice but ran only Apex hiring campaigns in the year to 15 Sep 2026. Linked for visibility; the hiring client owns the spend.'
from public.clients c
where a.client_id = c.id and c.name = 'All Dental of Menifee' and a.ad_account_id = '455243846115366';

insert into public.client_ad_accounts (client_id, ad_account_id, account_name, owns_spend, note)
select c.id, '455243846115366', 'All Dental of Menifee (Apex)', true,
       'Apex recruitment account (ISR, MB, Appt Setter, Actor hiring campaigns). Owned by the internal hiring client so the spend reaches the recruitment view, not a practice tracker.'
from public.clients c where c.name = 'Singleton Smile [Hiring Account]'
on conflict (client_id, ad_account_id) do nothing;

update public.clients set ad_account_id = null
where name = 'All Dental of Menifee' and ad_account_id = '455243846115366';

update public.clients c set ad_account_id = a.ad_account_id
from public.client_ad_accounts a
where a.client_id = c.id and a.owns_spend and c.ad_account_id is null
  and c.name = 'Natalie Yang Orthodontics';

/* Registry notes. */
update public.meta_ad_accounts set note = 'Natalie Yang Orthodontics, Vacaville. Identified from ad copy 15 Sep 2026.' where ad_account_id = '1358157841061189';
update public.meta_ad_accounts set note = 'Second location of Anaheim Smile Center (Dr. Zakhary), per the ad copy. Owned by Anaheim.' where ad_account_id = '875564064558385';
update public.meta_ad_accounts set note = 'Diamond Dental''s implant brand; same practice (Dr. Pourshirazi).' where ad_account_id = '931280679431754';
update public.meta_ad_accounts set note = 'Apex hiring account despite the name. Owned by Singleton Smile [Hiring Account].' where ad_account_id = '455243846115366';
update public.meta_ad_accounts set note = 'No ad in the 365 days to 15 Sep 2026. Nothing to attribute.' where ad_account_id = '1108321215187777';

/* Campaigns living in another practice's account. */
insert into public.campaign_practice_map (practice_name, campaign_external_id, client_id, note)
values
  ('Team Dental Swedesboro',   '120243538547920507', (select id from public.clients where name = 'Team Dental Swedesboro'),
   'Ran inside Ad Account 10 (TMJ Williston). Found from campaign name, 15 Sep 2026.'),
  ('Team Dental N. Liberties', '120243574005670507', (select id from public.clients where name = 'Team Dental N. Liberties'),
   'Ran inside Ad Account 10 (TMJ Williston). Found from campaign name, 15 Sep 2026.'),
  ('Smile Orthodontics',       '120241555269140437', (select id from public.clients where name = 'Smile Orthodontics'),
   'Ran inside Ad Account 7 (Wilmington). Ad copy: "Dr. Morina and the team at Smile Orthodontics", Leominster.'),
  ('Smile Orthodontics',       '120242721721180437', (select id from public.clients where name = 'Smile Orthodontics'),
   'Ran inside Ad Account 7 (Wilmington). Same copy as above.'),
  ('NK Orthodontics',          '120215142908870710', (select id from public.clients where name = 'NK Orthodontics'),
   'Ran inside Ad Account 6 (Singleton). Ad copy: "Dr. Nick Kim", Suwanee and Tucker GA. $37.7k in the year, none in the last 65 days. Not a Hub client by this name; rows are dropped, not given to Singleton.'),
  ('Smile Dental Studio',      '120238909005230290', (select id from public.clients where name = 'Smile Dental Studio'),
   'Ran inside Ad Account 9 (Tamara Levit). Ad copy: "Dr. Ganne and the team at Smile Dental Studio", Phoenix. Not a Hub client by this name.'),
  ('Smile Dental Studio',      '120239504770050507', (select id from public.clients where name = 'Smile Dental Studio'),
   'Ran inside Ad Account 10 (TMJ Williston). Same copy.'),
  ('Smile Dental Studio',      '120241936470930255', (select id from public.clients where name = 'Smile Dental Studio'),
   'Ran inside Ad Account 11 (SMYLE). Same copy.'),
  ('OC Healthy Smiles',        '120242807983740729', (select id from public.clients where name = 'OC Healthy Smiles'),
   'Ran inside Ad Account 12 (Team Dental). Ad copy: "Dr. Nguyen and the team at OC Healthy Smiles", Costa Mesa. Not a Hub client by this name.')
on conflict (practice_name, campaign_external_id) do nothing;
