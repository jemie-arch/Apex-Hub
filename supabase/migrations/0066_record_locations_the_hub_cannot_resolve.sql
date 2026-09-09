-- Sub-accounts that asked for a token and had no practice mapped to them.
--
-- /api/tokens/ghl?location=<id> answers 404 when no clients row carries that
-- crm_location_id. Make scenario 5560467's module #114 calls it once per call,
-- and #114 carries a builtin:Ignore handler — so a 404 drops that bundle
-- quietly, after the RAW DATA row is already written.
--
-- That is the right behaviour for pay: one unmapped practice must not stop a
-- 2,507-call drain. But it means the failure leaves no trace at all. No
-- incomplete execution, because Ignore does not park anything. No Slack notice,
-- because #110 is filtered off for the drain. Nothing but a "skipped" line in
-- an execution log nobody reads.
--
-- The drain is the one occasion this information exists. So the 404 path writes
-- the location id down, counted rather than duplicated, and "which practices is
-- the Hub missing" becomes a query instead of an archaeology exercise.
--
-- 80 of 81 clients currently carry a crm_location_id, so most calls resolve.
-- Anything appearing here is a practice live in GoHighLevel that the Hub has
-- never been told about.

create table crm_unmapped_locations (
  location_id   text primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  hits          integer     not null default 1,
  /* Whatever the caller was able to say about itself, for identification. */
  seen_via      text
);

comment on table crm_unmapped_locations is
  'GoHighLevel sub-account ids that requested a token from /api/tokens/ghl and '
  'matched no clients.crm_location_id. Written on the 404 path so that a '
  'silently skipped call still leaves evidence. Non-empty means practices exist '
  'in GoHighLevel that the Hub has never been told about.';

comment on column crm_unmapped_locations.hits is
  'How many times this location has been asked for. High counts identify an '
  'active practice missing from clients, rather than a stray one-off id.';

alter table crm_unmapped_locations enable row level security;

create policy crm_unmapped_locations_staff_read on crm_unmapped_locations
  for select
  using (auth_role() is not null and auth_role() <> 'client');

/*
 * Count one sighting.
 *
 * A function rather than an upsert from the application, so the counter
 * increments atomically. The drain runs up to 100 executions a minute and
 * several may hit the same unmapped location at once; a read-then-write from
 * the route would lose sightings.
 */
create or replace function note_unmapped_location(
  p_location_id text,
  p_seen_via    text default null
)
returns void
language sql
as $fn$
  insert into crm_unmapped_locations (location_id, seen_via)
  values (p_location_id, p_seen_via)
  on conflict (location_id) do update
    set last_seen_at = now(),
        hits         = crm_unmapped_locations.hits + 1,
        seen_via     = coalesce(excluded.seen_via, crm_unmapped_locations.seen_via);
$fn$;

comment on function note_unmapped_location(text, text) is
  'Records one request for a GoHighLevel sub-account matching no '
  'clients.crm_location_id, incrementing a counter rather than inserting a '
  'duplicate. Called from /api/tokens/ghl''s 404 path. Atomic, because the '
  'backlog drain can ask for the same missing location many times at once.';
