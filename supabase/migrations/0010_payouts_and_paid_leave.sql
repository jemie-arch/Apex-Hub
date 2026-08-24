-- ===========================================================================
-- Payout periods, payout lines, and what paid leave is worth in hours.
--
-- time_off_requests already existed — empty, with a time_off_kind enum of
-- vacation/sick/unpaid/parental/other and status on the shared request_status
-- type. This builds on it rather than beside it. An earlier draft tried to
-- create its own table and was a silent no-op, which is exactly how a duplicate
-- would have gone unnoticed until two features disagreed about which one held
-- the real requests.
--
-- The design decision worth recording is that a payout line stores the RATE IT
-- WAS CALCULATED AT rather than joining to the current rate on the profile. A
-- rate rise must not silently restate what somebody was paid three months ago,
-- and joining live would do exactly that. Same reasoning as the appointment
-- ledger storing amount_cents rather than recomputing it on read.
-- ===========================================================================

alter table user_profiles
  add column if not exists hourly_rate_cents integer,
  add column if not exists standard_daily_hours numeric(4,2) not null default 8;

comment on column user_profiles.hourly_rate_cents is
  'Pay rate in cents per hour. Null means no rate on record, and a payout line is then generated with hours but no amount rather than silently valuing the work at nothing.';

comment on column user_profiles.standard_daily_hours is
  'Hours one day of approved paid leave is worth. Needed because leave adds hours to a payout period, and a day off has no tracked time behind it to measure.';

create index if not exists time_off_requests_pending_idx
  on time_off_requests (status) where status = 'pending';

do $$ begin
  create type payout_state as enum ('open', 'locked', 'paid');
exception when duplicate_object then null; end $$;

create table if not exists payout_periods (
  id         uuid primary key default gen_random_uuid(),
  starts_on  date not null,
  ends_on    date not null,
  pay_date   date not null,
  state      payout_state not null default 'open',
  locked_at  timestamptz,
  created_at timestamptz not null default now(),
  constraint payout_period_dates_ordered check (ends_on >= starts_on),
  -- One period per fortnight, so a second generation run cannot fork them.
  constraint payout_periods_unique_span unique (starts_on, ends_on)
);

create table if not exists payout_lines (
  id                uuid primary key default gen_random_uuid(),
  period_id         uuid not null references payout_periods(id) on delete cascade,
  user_id           uuid not null references user_profiles(id) on delete cascade,
  tracked_hours     numeric(8,2) not null default 0,
  leave_hours       numeric(8,2) not null default 0,
  -- Stored, not joined. See the header.
  rate_cents        integer,
  amount_cents      bigint,
  hubstaff_user_id  text,
  computed_at       timestamptz not null default now(),
  constraint payout_lines_one_per_person unique (period_id, user_id)
);

create index if not exists payout_lines_user_idx on payout_lines (user_id);

comment on table payout_lines is
  'What one person is owed for one period. tracked_hours comes from Hubstaff, leave_hours from approved paid time off, and rate_cents is stored rather than joined so a later rate change cannot rewrite history. A null rate yields a null amount: hours with no money against them, rather than work valued at zero.';

comment on column payout_lines.amount_cents is
  'round((tracked_hours + leave_hours) * rate_cents). Null when the person has no rate on record.';

-- ---------------------------------------------------------------------------
-- Row level security. Everybody sees their own lines; admins see everyone.
-- ---------------------------------------------------------------------------
alter table payout_periods enable row level security;
alter table payout_lines   enable row level security;

drop policy if exists payout_periods_read on payout_periods;
create policy payout_periods_read on payout_periods for select using (true);

drop policy if exists payout_periods_admin on payout_periods;
create policy payout_periods_admin on payout_periods
  for all using (auth_is_admin()) with check (auth_is_admin());

drop policy if exists payout_lines_own_select on payout_lines;
create policy payout_lines_own_select on payout_lines
  for select using (auth_is_admin() or user_id = auth.uid());

drop policy if exists payout_lines_admin on payout_lines;
create policy payout_lines_admin on payout_lines
  for all using (auth_is_admin()) with check (auth_is_admin());

-- ---------------------------------------------------------------------------
-- Paid leave, in hours, for one person over a span.
--
-- Weekends are excluded. Counting Saturday and Sunday would pay somebody for
-- days they were never going to work, and would make a week off worth 56 hours
-- instead of 40.
--
-- Every kind except 'unpaid' counts as paid, which is where the existing enum
-- already draws the line.
--
-- Public holidays are NOT handled, deliberately. Apex staff span several
-- countries and there is no holiday calendar in this database to consult;
-- pretending otherwise would be worse than the honest gap.
-- ---------------------------------------------------------------------------
create or replace function paid_leave_hours(p_user_id uuid, p_from date, p_to date)
returns numeric
language sql
stable
as $fn$
  select coalesce(sum(
    (
      select count(*)
      from generate_series(
        greatest(t.starts_on, p_from),
        least(t.ends_on, p_to),
        interval '1 day'
      ) as d
      where extract(isodow from d) < 6
    ) * coalesce(u.standard_daily_hours, 8)
  ), 0)
  from time_off_requests t
  join user_profiles u on u.id = t.user_id
  where t.user_id = p_user_id
    and t.status = 'approved'
    and t.kind <> 'unpaid'
    and t.starts_on <= p_to
    and t.ends_on   >= p_from;
$fn$;

comment on function paid_leave_hours(uuid, date, date) is
  'Hours of approved paid leave for one person inside a span, weekends excluded. Every time_off_kind except unpaid counts as paid. Public holidays are not handled: staff span several countries and no holiday calendar exists here, so the gap is left visible rather than guessed at.';

-- ---------------------------------------------------------------------------
-- The fortnightly periods.
--
-- The anchor lives in app_settings because which day the cycle starts on is a
-- business fact, not a constant. Hard-coding a guess would put every period out
-- and nothing would fail loudly.
-- ---------------------------------------------------------------------------
insert into app_settings (key, value)
values ('payout_anchor_friday', to_jsonb('2026-01-03'::text))
on conflict (key) do nothing;

create or replace function ensure_payout_periods(p_through date default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_anchor  date;
  v_through date := coalesce(p_through, current_date + 14);
  v_start   date;
  v_made    integer := 0;
begin
  select (value #>> '{}')::date into v_anchor
  from app_settings where key = 'payout_anchor_friday';

  if v_anchor is null then
    raise exception 'payout_anchor_friday is not set in app_settings';
  end if;

  v_start := v_anchor;
  while v_start <= v_through loop
    insert into payout_periods (starts_on, ends_on, pay_date)
    values (v_start, v_start + 13, v_start + 13)
    on conflict (starts_on, ends_on) do nothing;
    if found then v_made := v_made + 1; end if;
    v_start := v_start + 14;
  end loop;

  return v_made;
end;
$fn$;

revoke all on function ensure_payout_periods(date) from public;
grant execute on function ensure_payout_periods(date) to service_role;

comment on function ensure_payout_periods(date) is
  'Creates fortnightly payout periods from the payout_anchor_friday setting up to p_through. Idempotent via the unique span constraint, so it is safe to call on every sync.';
