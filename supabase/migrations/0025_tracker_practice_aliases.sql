-- Make tracker practice-name matching data, not a migration.
--
-- The Client Fulfilment Tracker spells practices differently from the CRM, so
-- 0001_init.sql carried a hand-written list mapping six of them home — "Art of
-- Smile" to the full trading name, the "... Apex" suffixes, the Airway airport
-- abbreviations. That list did its job. The problem is where it lives: it ran
-- once, at migration time, so the next spelling the tracker invents needs a
-- developer and a deploy before those rows attach to a client.
--
-- Nothing in this repository writes tracker_appointments — the tracker is
-- imported by hand — so "a new name appeared" is a routine event, not a rare
-- one. A routine event should not require a migration.
--
-- Three parts:
--   tracker_practice_aliases   the mapping, as rows anyone can add
--   apply_tracker_aliases()    fills in null client_ids, returns how many
--   tracker_unmatched_names    what still has no home, so it is visible
--
-- Deliberately only fills nulls. A human who has corrected an attribution by
-- hand must not have it overwritten by a re-import, which is the rule the
-- original migration set and worth keeping.
create table if not exists tracker_practice_aliases (
  tracker_name text primary key,
  client_id    uuid not null references clients (id) on delete cascade,
  note         text,
  created_at   timestamptz not null default now()
);

comment on table tracker_practice_aliases is
  'How the Client Fulfilment Tracker spells a practice, mapped to the client it means. Replaces the one-off list in 0001_init.sql so a new spelling is an insert rather than a migration and a deploy. Only ever used to fill a null client_id — a correction made by hand is never overwritten.';

comment on column tracker_practice_aliases.note is
  'Why this mapping is right. Worth filling in: three of the original six were airport-style abbreviations that are not obvious to the next reader.';

insert into tracker_practice_aliases (tracker_name, client_id, note)
select v.tracker_name, c.id, v.note
from (values
  ('Art of Smile', 'Art Of Smile: Center for Cosmetic Orthodontics',
   'The CRM carries the full trading name.'),
  ('Team Dental N. Liberties Apex', 'Team Dental N. Liberties',
   'The tracker appends the agency''s own name.'),
  ('Team Dental Swedesboro Apex', 'Team Dental Swedesboro',
   'The tracker appends the agency''s own name.'),
  ('Airway Orthodontics - GNV', 'TMJ Sleep Airway Orthodontics - Gainesville',
   'Airport-style abbreviation. Confirmed 1 Sep 2026: the sheet''s Location ID column matches this client.'),
  ('Airway Orthodontics - NY', 'TMJ Sleep Airway Orthodontics - New York',
   'Airport-style abbreviation. Confirmed 1 Sep 2026 by Location ID.'),
  ('Airway Orthodontics - VT', 'TMJ Sleep Airway Orthodontics - Williston',
   'Three abbreviations against four locations, and Williston is the only one that is a real Vermont town. Confirmed 1 Sep 2026 by Location ID.')
) as v(tracker_name, client_name, note)
join clients c on c.name = v.client_name
on conflict (tracker_name) do nothing;

create or replace function apply_tracker_aliases()
returns integer
language plpgsql
as $fn$
declare
  filled integer;
begin
  update tracker_appointments t
  set client_id = a.client_id
  from tracker_practice_aliases a
  where t.client_id is null
    and t.location_name = a.tracker_name;
  get diagnostics filled = row_count;
  return filled;
end;
$fn$;

comment on function apply_tracker_aliases is
  'Attach tracker rows to clients using the alias table. Fills nulls only, so it is safe to run after every import and never undoes a hand correction. Returns how many rows it attached.';

create or replace view tracker_unmatched_names as
select
  t.location_name,
  count(*)                    as rows,
  min(t.booked_for)::date     as earliest,
  max(t.booked_for)::date     as latest,
  exists (select 1 from clients c
           where pps_normalise_practice(c.name) = pps_normalise_practice(t.location_name))
                              as a_client_of_that_name_exists
from tracker_appointments t
where t.client_id is null
  and t.location_name is not null
group by t.location_name
order by count(*) desc;

comment on view tracker_unmatched_names is
  'Tracker rows attached to no client, grouped by the spelling the sheet used. This is the queue for tracker_practice_aliases. a_client_of_that_name_exists distinguishes a spelling problem, which an alias fixes, from a practice that is genuinely not in the CRM — 0001 left Best Care Dental and Ofir Orthodontics unmatched for exactly that reason, and guessing a client for them would put somebody else''s consultations on a real practice''s numbers.';
