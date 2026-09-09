-- Agent commission, calculated the way the dashboard calculates it.
--
-- Every input here was established by reading the sheet's own formulas, because
-- nobody knew them — including the person who asked for the reconciliation:
--
--   J2  COUNTIFS('RAW DATA'!C:C, <agent>, 'RAW DATA'!N:N, "*Booked*", <dates>)
--   O2  IF(J2 < B15, J2*B12, IF(J2 < B16, J2*B13, J2*B14))
--
-- Count rows on the RAW DATA tab where the agent matches and the disposition
-- contains "Booked", inside the window A7 selects, then apply a flat rate to
-- ALL of them, chosen by which threshold the count falls under.
--
-- It is a cliff, not a marginal tier. An agent on 95 bookings earns 95 x $8;
-- one on 96 earns 96 x $10. The 96th booking is worth $200. This reproduces
-- that rather than improving on it — the point is to agree with what people are
-- actually paid, and a fairer calculation would only add a third number to an
-- argument that already had two.
--
-- Rates come from app_settings.isa_commission_scheme, which turned out to be
-- correct already: unitAmount 800, quota1Amount 1000, quota2Amount 1200,
-- thresholds 96 and 128 — matching INPUT VALUES B12 to B16 to the cent. Pay
-- never needed a new model. Only the count was missing, and it was missing
-- because the Hub was counting the BOOKING SHEET tab while the dashboard
-- counted RAW DATA.
--
-- KNOWN GAP, read before quoting a figure. Agents appear here who do not appear
-- on the dashboard at all: its agent column is a FILTER over the INPUT VALUES
-- active list, and that list names two people. Jennelyn Salazar and Erick
-- Mendoza have real bookings and real commission below, and are not paid it.
-- That is a question for whoever owns the scheme, not a defect in this view.

create or replace view v_agent_commission as
with scheme as (
  select
    coalesce((value ->> 'unitAmount')::numeric, 800)    as unit_cents,
    coalesce((value ->> 'quota1Amount')::numeric, 1000) as quota1_cents,
    coalesce((value ->> 'quota2Amount')::numeric, 1200) as quota2_cents,
    coalesce((value ->> 'quota1Threshold')::int, 96)    as quota1_threshold,
    coalesce((value ->> 'quota2Threshold')::int, 128)   as quota2_threshold
  from app_settings
  where key = 'isa_commission_scheme'
),
counted as (
  select
    g.id                                  as agent_id,
    g.display_name,
    g.user_id,
    g.is_active,
    count(*) filter (
      where r.called_on = current_date and r.disposition ilike '%booked%'
    ) as booked_today,
    count(*) filter (
      where r.called_on = current_date - 1 and r.disposition ilike '%booked%'
    ) as booked_yesterday,
    count(*) filter (
      where r.called_on >= current_date - 2 and r.disposition ilike '%booked%'
    ) as booked_3d,
    count(*) filter (
      where r.called_on >= current_date - 6 and r.disposition ilike '%booked%'
    ) as booked_7d,
    count(*) filter (
      where r.called_on >= current_date - 29 and r.disposition ilike '%booked%'
    ) as booked_30d,
    count(*) filter (where r.called_on >= current_date - 29) as calls_30d
  from call_agents g
  left join raw_call_rows r on r.agent_id = g.id
  group by g.id, g.display_name, g.user_id, g.is_active
)
select
  c.agent_id,
  c.display_name,
  c.user_id,
  c.is_active,
  c.calls_30d,
  c.booked_today,
  c.booked_yesterday,
  c.booked_3d,
  c.booked_7d,
  c.booked_30d,
  /* Which band the 30-day count falls in, named rather than inferred. */
  case
    when c.booked_30d < s.quota1_threshold then 'base'
    when c.booked_30d < s.quota2_threshold then 'quota1'
    else 'quota2'
  end as band,
  case
    when c.booked_30d < s.quota1_threshold then s.unit_cents
    when c.booked_30d < s.quota2_threshold then s.quota1_cents
    else s.quota2_cents
  end as rate_cents,
  (c.booked_30d *
    case
      when c.booked_30d < s.quota1_threshold then s.unit_cents
      when c.booked_30d < s.quota2_threshold then s.quota1_cents
      else s.quota2_cents
    end
  )::bigint as commission_cents,
  /*
   * How many more bookings would move this agent up a band. On a cliff rate
   * this is the most actionable number on the row — an agent two bookings short
   * is two bookings away from every booking they have already made being worth
   * more, and deserves to know that.
   */
  case
    when c.booked_30d < s.quota1_threshold then s.quota1_threshold - c.booked_30d
    when c.booked_30d < s.quota2_threshold then s.quota2_threshold - c.booked_30d
  end as bookings_to_next_band
from counted c
cross join scheme s;

comment on view v_agent_commission is
  'Per-agent booked counts over the windows the pay dashboard offers, and the '
  'commission its O2 formula would pay on the 30-day window. Reproduces the '
  'sheet deliberately, including the cliff: the rate applies to ALL bookings, '
  'so the 96th booking is worth $200. Rates read from '
  'app_settings.isa_commission_scheme. NOTE: agents appear here who do not '
  'appear on the dashboard at all, because its agent list names only two '
  'people — their commission is calculated but not paid.';
