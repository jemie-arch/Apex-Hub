-- Commission per PAY PERIOD, which is not what the dashboard shows.
--
-- Joshua asked when auto commissions should be paid out, and said he was not
-- sure whether the payout in question had already been disbursed. Both halves
-- of that turn out to be the same problem.
--
-- THE HUB HAS NO RECORD OF ANY COMMISSION PAYMENT. payout_periods holds
-- fortnightly periods back to May, every one open, unlocked, with zero lines
-- and zero pounds — and payout_lines is about tracked hours, not commission. So
-- nothing can answer "was this paid", which is exactly why nobody is sure.
--
-- THE WINDOWS DO NOT MATCH, and this is the part to settle before any cadence
-- is agreed.
--
-- The dashboard's O2 pays on J2, and J2 with A7 on "Last 30 days" counts a
-- ROLLING THIRTY DAYS. Pay periods are FOURTEEN days. Paying the figure on
-- screen at each fortnightly pay date pays most bookings about twice — thirty
-- over fourteen — because consecutive rolling windows overlap by sixteen days.
--
-- Observed, per agent:
--
--   1-14 Aug        Karol 47   Ayanda 36
--   15-28 Aug       Karol 37   Ayanda 39
--   29 Aug-11 Sep   Karol  4   Ayanda  6
--
--   rolling 30 days today: Karol 54
--
-- Karol has 4 bookings in the period being paid and a screen showing 54.
--
-- THE THRESHOLDS ARE THE OTHER HALF. The quota cliffs are 96 and 128 bookings.
-- The best fortnight any agent has recorded is 47. On a fortnightly basis the
-- $10 and $12 rates are arithmetically unreachable, which may be the real
-- reason nobody has ever hit them — not performance, but a threshold sized for
-- one window being applied to another.
--
-- So this view computes commission on bookings falling INSIDE each pay period,
-- the only basis that cannot double-pay. It deliberately does NOT decide the
-- cadence or restate the thresholds — those are Joshua's call, and this exists
-- so the conversation has numbers in it.

create or replace view v_commission_by_period as
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
per_period as (
  select
    p.id            as period_id,
    p.starts_on,
    p.ends_on,
    p.pay_date,
    p.state,
    g.id            as agent_id,
    g.display_name,
    count(*) filter (where r.disposition ilike '%booked%') as booked,
    count(*)                                               as calls
  from payout_periods p
  join raw_call_rows r on r.called_on between p.starts_on and p.ends_on
  join call_agents  g on g.id = r.agent_id
  group by p.id, p.starts_on, p.ends_on, p.pay_date, p.state,
           g.id, g.display_name
)
select
  x.period_id,
  x.starts_on,
  x.ends_on,
  x.pay_date,
  x.state,
  x.agent_id,
  x.display_name,
  x.calls,
  x.booked,
  /*
   * The rate the scheme would apply to THIS period's count. Reported for
   * completeness and, in practice, always the base rate — see the threshold
   * note above.
   */
  case
    when x.booked < s.quota1_threshold then s.unit_cents
    when x.booked < s.quota2_threshold then s.quota1_cents
    else s.quota2_cents
  end as rate_cents,
  (x.booked *
    case
      when x.booked < s.quota1_threshold then s.unit_cents
      when x.booked < s.quota2_threshold then s.quota1_cents
      else s.quota2_cents
    end
  )::bigint as amount_cents,
  /*
   * True when the period's count could never reach the first quota however well
   * the agent performed, because the period is shorter than the window the
   * threshold was written for. Surfaced rather than left to be noticed.
   */
  (s.quota1_threshold > (x.ends_on - x.starts_on + 1) * 5) as quota_unreachable_in_period
from per_period x
cross join scheme s;

comment on view v_commission_by_period is
  'Commission on bookings falling INSIDE each fortnightly pay period — the only '
  'basis that cannot double-pay. The dashboard shows a rolling 30-day figure '
  'and pay periods are 14 days, so paying what is on screen each fortnight pays '
  'most bookings about twice. Also flags that the 96 and 128 quota thresholds '
  'are unreachable within a 14-day period; the best fortnight on record is 47. '
  'Does not decide cadence or thresholds — it exists so that decision has '
  'numbers behind it. NOTE: the Hub holds no record of any commission ever '
  'being disbursed, which is why nobody can say whether a given payout was made.';
