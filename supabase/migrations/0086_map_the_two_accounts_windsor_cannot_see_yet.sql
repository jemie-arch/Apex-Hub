/*
 * Eagle Creek Dentistry and Dental Design Studios get their ad accounts.
 *
 * Both ids come from Jemie's Business Manager list (0084), where they were
 * recorded but deliberately left unmapped because neither account is connected
 * to Windsor, so mapping them moves no money. That reasoning conflated two
 * different facts. Whether a practice owns an account is true or false on its
 * own; whether Windsor can read that account is a separate problem for a
 * separate person. Recording the ownership now means that the day someone
 * connects the account in Windsor, the spend lands without anyone having to
 * remember this migration existed.
 *
 *   1954291958818137  AC - Eagle Creek Dentistry       -> Eagle Creek Dentistry
 *   689259685445341   Dental Design Studio (Gilbert)   -> Dental Design Studios
 *
 * Until connected, both rows keep showing appointments against zero spend, and
 * the Settings page's registry marks the reason.
 */
insert into public.client_ad_accounts (client_id, ad_account_id, account_name, owns_spend, note)
select c.id, '1954291958818137', 'AC - Eagle Creek Dentistry', true,
       'From Jemie''s Business Manager list, 15 Sep 2026. Account is NOT connected to Windsor; spend lands only once it is.'
from public.clients c where c.name = 'Eagle Creek Dentistry'
on conflict (client_id, ad_account_id) do nothing;

insert into public.client_ad_accounts (client_id, ad_account_id, account_name, owns_spend, note)
select c.id, '689259685445341', 'Dental Design Studio (Gilbert)', true,
       'From Jemie''s Business Manager list, 15 Sep 2026. Account is NOT connected to Windsor; spend lands only once it is.'
from public.clients c where c.name = 'Dental Design Studios'
on conflict (client_id, ad_account_id) do nothing;

update public.clients c set ad_account_id = a.ad_account_id
from public.client_ad_accounts a
where a.client_id = c.id and a.owns_spend and c.ad_account_id is null
  and c.name in ('Eagle Creek Dentistry', 'Dental Design Studios');
