-- Leads from GoHighLevel, and a view that compares the three sources.
--
-- Joshua reports that the Hub's lead numbers do not agree with GoHighLevel.
-- They cannot agree, and it is worth being exact about why: nothing has ever
-- read leads from GoHighLevel. The CRM syncs are clients, appointments, deals
-- and calls. There is no contacts feed.
--
-- What the Hub reports is leads_best = greatest(leads_windsor, leads_tracker):
--
--   leads_windsor  Meta, via Windsor. Reports ZERO for 35 of the 39 accounts
--                  that spent money in the last 30 days, because the
--                  conversion events are not reaching Meta.
--   leads_tracker  the Fulfilment Tracker sheet, typed by hand, and until
--                  today never re-imported since 22 August.
--
-- So the disagreement is a missing feed rather than a miscount. It also cannot
-- be settled either way — in Joshua's favour or ours — until the two counts sit
-- next to each other, which is what v_lead_reconciliation below is for.
--
-- A LEAD IS A CONTACT CREATED IN THE WINDOW.
--
-- dateAdded, not a tag and not a pipeline stage. Tags and stages are set up
-- per sub-account by whoever built the automation, so counting them would
-- compare practices by how their CRM was configured rather than by how many
-- people enquired.

create table crm_leads (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients (id) on delete cascade,

  -- GoHighLevel's contact id, and the identity this table is keyed on. One
  -- contact is one lead; a re-run updates rather than counting them twice.
  crm_contact_id text not null,

  /*
   * Both the instant and the date.
   *
   * The date is what a daily count groups by and what joins to the other two
   * feeds, which are date-grained. The instant is kept because a lead near
   * midnight lands on a different day depending on the timezone, and being
   * able to show that is the difference between explaining a one-day
   * discrepancy and arguing about it.
   */
  created_at_utc timestamptz not null,
  created_on     date not null,

  lead_name      text,
  lead_email     text,
  lead_phone     text,

  -- GoHighLevel's own source word, plus the tags a human typed. A referral has
  -- no utm and no ad id; the tag is the only record it exists.
  source         text,
  tags           text[] not null default '{}',

  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  ad_external_id       text,
  campaign_external_id text,

  synced_at      timestamptz not null default now(),

  unique (crm_contact_id)
);

create index crm_leads_client_day_idx on crm_leads (client_id, created_on);
create index crm_leads_day_idx on crm_leads (created_on);

alter table crm_leads enable row level security;

/*
 * Read by any signed-in member of staff, scoped to their own group the way
 * every other client-bearing table is. No insert or update policy: the sync
 * writes with the service role, which bypasses RLS, and a lead is never
 * created by hand.
 */
create policy crm_leads_read on crm_leads
  for select
  using (
    auth_is_admin()
    or client_id in (
      select id from clients where group_id = auth_group_id()
    )
  );

comment on table crm_leads is
  'Leads from GoHighLevel: one row per contact, keyed on the contact id, dated '
  'by dateAdded. The feed the Hub never had — which is why its lead numbers '
  'could not be reconciled against the CRM. A lead is a contact created in the '
  'window, deliberately not a tag or a pipeline stage, because those are '
  'configured per sub-account and would compare practices by their CRM setup '
  'rather than by how many people enquired.';

/*
 * The three sources, side by side, one row per practice per day.
 *
 * A full join across all three rather than a join from any one of them: a day
 * that exists in the CRM and not the sheet is exactly the discrepancy this
 * exists to show, and starting from either side would hide it.
 */
create view v_lead_reconciliation
with (security_invoker = on) as
  with crm as (
    select client_id, created_on as day, count(*) as crm_leads
    from crm_leads
    group by client_id, created_on
  ),
  sheet as (
    select client_id, received_on as day, sum(coalesce(lead_count, 1)) as sheet_leads
    from tracker_leads
    where client_id is not null
    group by client_id, received_on
  ),
  meta as (
    select client_id, insight_on as day, sum(leads) as windsor_leads
    from ad_level_insights
    where client_id is not null
    group by client_id, insight_on
  ),
  spine as (
    select client_id, day from crm
    union select client_id, day from sheet
    union select client_id, day from meta
  )
  select
    s.client_id,
    c.name as client_name,
    c.group_id,
    s.day,
    coalesce(m.windsor_leads, 0)::bigint as windsor_leads,
    coalesce(t.sheet_leads, 0)::bigint   as sheet_leads,
    coalesce(g.crm_leads, 0)::bigint     as crm_leads,
    -- What the Hub reports today, so the comparison is against the real
    -- figure rather than against one of its inputs.
    greatest(
      coalesce(m.windsor_leads, 0),
      coalesce(t.sheet_leads, 0)
    )::bigint as leads_best_reported,
    /*
     * The CRM is the reference. It is the only one of the three that records a
     * lead at the moment it arrives, without a person typing it or Meta
     * choosing to report it — so a gap against it is the honest measure of how
     * wrong the reported figure is.
     *
     * Signed on purpose. Negative means the Hub reports MORE than the CRM has,
     * which is a different fault from reporting fewer and should not be hidden
     * by an absolute value.
     */
    (greatest(coalesce(m.windsor_leads, 0), coalesce(t.sheet_leads, 0))
      - coalesce(g.crm_leads, 0))::bigint as reported_minus_crm
  from spine s
    join clients c on c.id = s.client_id
    left join crm   g on g.client_id = s.client_id and g.day = s.day
    left join sheet t on t.client_id = s.client_id and t.day = s.day
    left join meta  m on m.client_id = s.client_id and m.day = s.day;

comment on view v_lead_reconciliation is
  'One row per practice per day with all three lead counts and the gap. '
  'crm_leads is the reference: it is the only source that records a lead when '
  'it arrives rather than when somebody types it or Meta decides to report it. '
  'reported_minus_crm is signed — negative means the Hub reports more leads '
  'than the CRM holds, which is a different problem from reporting fewer. '
  'Zero in every column for a day means no source saw anything, not that the '
  'day agrees.';
