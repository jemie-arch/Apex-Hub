/*
 * Every ad account in Business Manager 01, as Meta lists them.
 *
 * Jemie pulled the list on 15 September: 47 accounts with Meta's own names.
 * Two things it settles that Windsor's account list could not.
 *
 * NAMES. Windsor reports several accounts only as "Ad Account N". Meta's list
 * names them: "Ad Account 5" is All Dental of Menifee (Apex). Others are still
 * numbered in Meta itself, so the number IS the name and nothing here can
 * improve on it.
 *
 * COVERAGE. Windsor sees 50 accounts; Business Manager holds 47; they are not
 * the same 47. Four are in Meta and NOT connected to Windsor, so their spend
 * cannot reach the Hub by any route until somebody connects them:
 *
 *   1954291958818137  AC - Eagle Creek Dentistry     (a live client, 4 appts)
 *   689259685445341   Dental Design Studio (Gilbert)  (a live client, 6 appts)
 *   1319155668897270  Wagner Orthodontics A           (no client in the Hub)
 *   1091482990109750  PNW Survival Games              (not dental)
 *
 * Five are in Windsor and NOT in this Business Manager - they live somewhere
 * else, or in a personal account, and this registry does not know them.
 *
 * This is a registry, not a mapping. Which client owns which account is
 * client_ad_accounts (0083). This table exists so that "unmapped" can be told
 * apart from "not even connected", which need different people to fix.
 */
create table if not exists public.meta_ad_accounts (
  ad_account_id text primary key,
  meta_name text not null,
  business_manager text not null default 'Business Manager 01',
  /* Whether Windsor returned this account on 15 Sep 2026. */
  connected_to_windsor boolean not null default false,
  note text,
  listed_at timestamptz not null default now()
);

alter table public.meta_ad_accounts enable row level security;

comment on table public.meta_ad_accounts is
  'Ad accounts as Meta Business Manager lists them, with whether Windsor can see each. A registry, not a mapping - ownership lives in client_ad_accounts.';

insert into public.meta_ad_accounts (ad_account_id, meta_name, connected_to_windsor, note) values
  ('1795038078588158','1795038078588158', true,  'Unnamed in Meta. Windsor calls it "Erika Kullberg". Carries campaign 52545283332165, which Integrity Dental''s stat sheet records.'),
  ('1104523434966094','2019210581',       true,  'Unnamed in Meta; the displayed number is not the account id. Cruz Orthodontics.'),
  ('1954291958818137','AC - Eagle Creek Dentistry', false, 'NOT connected to Windsor. Live client with appointments; spend unreachable until connected.'),
  ('931280679431754', 'AC - Select Dental Implants', true, 'No client in the Hub by this name.'),
  ('821552883812927', 'Abraham Orthodontics', true, null),
  ('1364841078777057','Ad Account 10', true, 'Shared by the three TMJ Sleep Airway locations.'),
  ('1189070893015233','Ad Account 11', true, 'SMYLE Dental Centers'' second account.'),
  ('2448322745599201','Ad Account 12', true, 'No campaign returned in the last 30 days.'),
  ('4349453411844788','Ad Account 4',  true, 'Runs "B2B Dental v6.2" - agency B2B, not a practice.'),
  ('270725855039085', 'Ad Account 6',  true, 'Singleton Smile Dental.'),
  ('569740232443261', 'Ad Account 7',  true, 'Wilmington Family Dental.'),
  ('4379973445580398','Ad Account 8',  true, 'The Smile Lounge.'),
  ('25984815481156126','Ad Account 9', true, 'Tamara Levit DDS PC.'),
  ('455243846115366', 'All Dental of Menifee (Apex)', true, 'Windsor shows it only as "Ad Account 5". No campaign in the last 30 days.'),
  ('829628406004945', 'Art of Smile Ads', true, null),
  ('3267173910102547','Beta', true, 'Andros Orthodontics, confirmed by campaign.'),
  ('1181529647508856','Bling Dental ads', true, null),
  ('875564064558385', 'Buena Park Dental Center', true, 'Buena Park appears as a lead_source on City Dental Centers rows. Likely a City Dental location; unconfirmed.'),
  ('124074985964948', 'City Dental Centers 90 Degree Corona Implant', true, null),
  ('3009808609223608','DNA Ad Account 2', true, 'Carries campaign 120255634354000159, "Apex | $3679 for Invisalign".'),
  ('689259685445341', 'Dental Design Studio (Gilbert)', false, 'NOT connected to Windsor. Live client with appointments; spend unreachable until connected.'),
  ('1613390633831803','Dental Illusions Ad Account', true, null),
  ('1669516684030629','Dental Solutions 2 Ad Account', true, null),
  ('914912008083810', 'Elena Dana Marcarian Ad Account', true, 'Magic Dental, confirmed by campaign.'),
  ('1942676286640900','Essex Dental Arts 2', true, null),
  ('3716479631996128','Fiesta Orthodontics', true, null),
  ('1662696267246527','Free whitening', true, 'Plano Top Dental, confirmed by campaign.'),
  ('680241230440661', 'Great Smiles of La Mesa', true, 'Carries campaign 120248836261790366.'),
  ('1408113864452325','HEB Family Dental', true, null),
  ('655516055301657', 'Hales Parker Dentistry', true, 'The Dental Collective, confirmed by campaign.'),
  ('1603685990171948','Kind Dental Facebook Ads', true, 'Two campaigns: Kind Dental and Kind Dental General Dentistry.'),
  ('3971056033196909','Lompoc Family Dental Ad Account', true, null),
  ('1358157841061189','NYO', true, 'Runs "Conversion | Apr 21, 2026". No client identified.'),
  ('1091482990109750','PNW Survival Games Ad Account', false, 'Not dental. Ignore.'),
  ('1200389502206899','Smile Center Ad Account', true, 'Smile and Implant Center of Rockland.'),
  ('930319989503609', 'Smile Orthodontics', true, null),
  ('832814773861221', 'SmilesWestTexas', true, 'Hancock and Johnston Dentistry, confirmed by campaign.'),
  ('827429053287394', 'Smyle Dental Implant Centers Ad Account', true, 'SMYLE Dental Centers'' first account.'),
  ('315839855',       'Sparkill Dental Meta', true, null),
  ('1108321215187777','Stephen Tran, DDS Ad Account', true, 'No client in the Hub by this name.'),
  ('1020057142322568','The Smile Patio', true, null),
  ('1890870361730741','Ultra Smiles Orthodontics Ad Account', true, null),
  ('1307464760364126','Village dental of New ENgland', true, 'Shared by Village Dental and its General Dentistry location.'),
  ('1319155668897270','Wagner Orthodontics A', false, 'NOT connected to Windsor. No client in the Hub by this name.'),
  ('2657359854648619','anaheimsmilecenter Ad Account', true, null),
  ('2190253088404001','athanasius.dds@gmail.com', true, 'Genuine Family Dentistry, confirmed by campaign.'),
  ('671468608832531', 'bespoke_orthodontics_ Ad Account', true, null)
on conflict (ad_account_id) do update
  set meta_name = excluded.meta_name,
      connected_to_windsor = excluded.connected_to_windsor,
      note = coalesce(excluded.note, meta_ad_accounts.note);

/* Give client_ad_accounts the real Meta names where it was carrying nothing. */
update public.client_ad_accounts a
set account_name = m.meta_name
from public.meta_ad_accounts m
where m.ad_account_id = a.ad_account_id
  and (a.account_name is null or a.account_name = a.ad_account_id);
