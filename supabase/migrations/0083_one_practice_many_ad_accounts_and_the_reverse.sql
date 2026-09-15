/*
 * A practice can have several ad accounts. Several practices can share one.
 * clients.ad_account_id allows neither, and both are real.
 *
 * Found by cross-checking Joshua's campaign list against Windsor, which returns
 * the ad account each campaign lives in:
 *
 *   SMYLE Dental Centers runs on two accounts. The second - "Ad Account 11",
 *   1189070893015233, carrying two of Joshua's campaigns - is attached to no
 *   client at all, so its spend has never reached the tracker.
 *
 *   The three TMJ Sleep Airway locations share one account and one campaign.
 *   Village Dental of New England and its General Dentistry location share one
 *   account. Only one client in each set has the id on it, because the column
 *   is singular.
 *
 * The obvious fix - set the same id on all three TMJ rows - would have been
 * worse than the gap. windsor-ads keys clients by ad account in a Map, so with
 * three clients on one account the last row loaded wins silently and the other
 * two get nothing. Which one wins depends on row order. That is misattribution
 * dressed as a fix, and it is why this table exists instead.
 *
 * owns_spend IS THE POINT. Exactly one client per ad account owns its spend
 * for reporting - enforced by the partial unique index - and any others are
 * linked so the relationship is visible without the money being counted twice
 * or assigned by accident. For a genuinely shared account there is no honest
 * way to split the spend between locations from Meta's data alone, so the
 * currently-mapped client keeps ownership and behaviour does not change; the
 * link just stops being invisible.
 *
 * clients.ad_account_id is left in place and still populated. windsor-ads
 * reads this table from 0083 on; the column stays as a fallback and because
 * eleven other places read it and each deserves its own decision.
 */
create table if not exists public.client_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  ad_account_id text not null,
  /* Windsor's name for it, so "Ad Account 11" and "Beta" are recognisable. */
  account_name text,
  /*
   * Whether this client is the one whose tracker the account's spend lands on.
   * One owner per account, always. A linked non-owner sees the relationship
   * and gets none of the money.
   */
  owns_spend boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  unique (client_id, ad_account_id)
);

create unique index if not exists client_ad_accounts_one_owner_per_account
  on public.client_ad_accounts (ad_account_id)
  where owns_spend;

alter table public.client_ad_accounts enable row level security;

comment on table public.client_ad_accounts is
  'Practice to Meta ad account, many-to-many. Exactly one client owns each account''s spend (owns_spend), enforced by a partial unique index; others are linked without being counted. Replaces the singular clients.ad_account_id for spend attribution - see 0083.';

/* 1. Every existing mapping becomes an owner. Behaviour unchanged. */
insert into public.client_ad_accounts (client_id, ad_account_id, owns_spend, note)
select id, regexp_replace(ad_account_id, '^act_', ''), true,
       'Carried over from clients.ad_account_id.'
from public.clients
where ad_account_id is not null
on conflict (client_id, ad_account_id) do nothing;

/* 2. SMYLE's second account. Nobody owned it; its spend never landed anywhere. */
insert into public.client_ad_accounts (client_id, ad_account_id, account_name, owns_spend, note)
select c.id, '1189070893015233', 'Ad Account 11', true,
       'Second SMYLE account. Carries campaigns 120252263705850255 and 120252581312880255 per Joshua''s list; confirmed against Windsor 15 Sep 2026. Unattributed until now.'
from public.clients c
where c.name = 'SMYLE Dental Centers'
on conflict (client_id, ad_account_id) do nothing;

/* 3. The shared accounts - linked, not owning, so nothing double-counts. */
insert into public.client_ad_accounts (client_id, ad_account_id, account_name, owns_spend, note)
select c.id, '1364841078777057', 'Ad Account 10', false,
       'Shared with TMJ Williston, which owns the spend. One campaign serves all three TMJ locations; Meta cannot split it between them.'
from public.clients c
where c.name in ('TMJ Sleep Airway Orthodontics - Gainesville',
                 'TMJ Sleep Airway Orthodontics - New York')
on conflict (client_id, ad_account_id) do nothing;

insert into public.client_ad_accounts (client_id, ad_account_id, account_name, owns_spend, note)
select c.id, '1307464760364126', 'Village dental of New ENgland', false,
       'Shared with Village Dental of New England, which owns the spend. The GD location runs its own campaign (120246204913770597) inside the same account.'
from public.clients c
where c.name = 'Village Dental of New England (General Dentistry)'
on conflict (client_id, ad_account_id) do nothing;

/* 4. Names from Windsor for the ones that have unhelpful ones. */
update public.client_ad_accounts a set account_name = v.n
from (values
  ('3267173910102547','Beta'),
  ('655516055301657','Hales Parker Dentistry'),
  ('914912008083810','Elena Dana Marcarian Ad Account'),
  ('2190253088404001','athanasius.dds@gmail.com'),
  ('832814773861221','SmilesWestTexas'),
  ('1662696267246527','Free whitening'),
  ('270725855039085','Ad Account 6'),
  ('569740232443261','Ad Account 7'),
  ('4379973445580398','Ad Account 8'),
  ('25984815481156126','Ad Account 9'),
  ('1364841078777057','Ad Account 10'),
  ('1104523434966094','2019210581'),
  ('1522430326001923','Ad Account 13')
) as v(id, n)
where a.ad_account_id = v.id and a.account_name is null;
