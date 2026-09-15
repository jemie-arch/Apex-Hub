/*
 * Two more practices get their ad account. The 30-day window hid both.
 *
 * The triangulation in 0083/0084 asked Windsor which account each of
 * Joshua's campaigns lives in, over the last 30 days. Four campaigns came back
 * empty, and "not seen in 30 days" looked like "paused". Widening to 65 days
 * on 15 September showed two of them spending:
 *
 *   52517897808203      Diamond Dental      lives in 931280679431754
 *                       "AC - Select Dental Implants"  -  $779.58 / 65d
 *   120250627508050729  Team Dental         lives in 2448322745599201
 *                       "Ad Account 12"                -  $1,470.50 / 65d
 *
 * 0084 recorded both accounts as belonging to no client. That was the window,
 * not the data. Both practices are live, have stat sheets, and until now had
 * no ad account at all, so their spend has never reached the tracker.
 *
 * Team Dental is two locations (N. Liberties, Swedesboro) sharing one campaign,
 * the same shape as the three TMJ locations. N. Liberties owns the spend - it
 * carries more of the booked appointments (5 vs 3) - and Swedesboro is linked.
 * Meta cannot split one campaign between two practices, so this is a choice,
 * recorded here so it can be changed on purpose rather than by accident.
 *
 * Still unseen in 65 days: Bling Dental's 120241938955350485. Bling's other
 * campaign is live on 1181529647508856, so Bling is mapped; that one campaign
 * is old. Nothing to do.
 */

/* Diamond Dental owns the account Meta calls "AC - Select Dental Implants". */
insert into public.client_ad_accounts (client_id, ad_account_id, account_name, owns_spend, note)
select c.id, '931280679431754', 'AC - Select Dental Implants', true,
       'Carries campaign 52517897808203 from Joshua''s list. Confirmed against Windsor over 65 days, 15 Sep 2026.'
from public.clients c
where c.name = 'Diamond Dental'
on conflict (client_id, ad_account_id) do nothing;

/* Team Dental: N. Liberties owns, Swedesboro is linked. One campaign, two doors. */
insert into public.client_ad_accounts (client_id, ad_account_id, account_name, owns_spend, note)
select c.id, '2448322745599201', 'Ad Account 12', true,
       'Carries campaign 120250627508050729, shared with Team Dental Swedesboro. Confirmed against Windsor over 65 days, 15 Sep 2026.'
from public.clients c
where c.name = 'Team Dental N. Liberties'
on conflict (client_id, ad_account_id) do nothing;

insert into public.client_ad_accounts (client_id, ad_account_id, account_name, owns_spend, note)
select c.id, '2448322745599201', 'Ad Account 12', false,
       'Shared with Team Dental N. Liberties, which owns the spend. One campaign serves both locations; Meta cannot split it.'
from public.clients c
where c.name = 'Team Dental Swedesboro'
on conflict (client_id, ad_account_id) do nothing;

/* The singular column stays populated for the eleven places that still read it. */
update public.clients c set ad_account_id = a.ad_account_id
from public.client_ad_accounts a
where a.client_id = c.id and a.owns_spend and c.ad_account_id is null
  and c.name in ('Diamond Dental', 'Team Dental N. Liberties');

/* Correct the registry: these two were never orphans. */
update public.meta_ad_accounts set note = 'Diamond Dental. Carries campaign 52517897808203; the 30-day window in 0084 missed it.'
where ad_account_id = '931280679431754';
update public.meta_ad_accounts set note = 'Team Dental (N. Liberties owns, Swedesboro linked). Carries campaign 120250627508050729; the 30-day window in 0084 missed it.'
where ad_account_id = '2448322745599201';
