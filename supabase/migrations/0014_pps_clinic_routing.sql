-- ===========================================================================
-- One table that says which sheet a clinic's bookings belong in.
--
-- The whole fault class this replaces exists for one reason: the spreadsheet id
-- lives inside each of 56 hand-cloned scenarios, eight times over in the newer
-- ones. Every clone is a chance to paste the wrong id, and the interface gives
-- nobody a way to see it. Four scenarios are misdirected today, one reads a file
-- nothing writes to, and two practices share a file neither can prove it owns.
--
-- Auditing that finds the mistakes. It does not stop them. What stops them is
-- having the id in exactly one place, keyed on something the webhook already
-- carries — location.id, which GoHighLevel sends on every booking — so a
-- scenario never names a sheet at all. Then adding a practice is a row here, not
-- a clone, and there is no per-practice configuration left to get wrong.
--
-- The rule this table follows, learned the hard way today: it proposes and never
-- guesses. A row exists only when somebody confirmed it. Everything unconfirmed
-- sits in pps_routing_candidates with its evidence, and everything missing sits
-- in pps_routing_gaps. A half-built routing table that silently sends a
-- practice's patients to the wrong sheet would be worse than the 56 clones.
-- ===========================================================================

create extension if not exists pg_trgm;

create table if not exists pps_clinic_routing (
  client_id        uuid primary key references clients (id) on delete cascade,
  -- The join key. This is what arrives in the webhook payload as location.id,
  -- which is why routing is keyed on it rather than on a practice name: names
  -- are typed by people and drift, ids do not.
  crm_location_id  text        not null unique,
  practice         text        not null,
  -- Null is a legitimate, meaningful state: the clinic is known and its sheet
  -- is not. That is a gap to fill, not a row to omit — omitting it is how a
  -- practice goes quietly unrouted.
  spreadsheet_id   text,
  -- 'derived' came from matching the audited scenarios; 'manual' was entered by
  -- a person. Kept apart so a derived row can be re-derived safely while a
  -- manual correction is never overwritten by the machine.
  source           text        not null default 'derived'
                     check (source in ('derived', 'manual')),
  -- Unverified rows are deliberately NOT usable. The export view filters on
  -- this, so nothing reaches the automation until a human has agreed with it.
  verified_at      timestamptz,
  verified_by      uuid references user_profiles (id),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table pps_clinic_routing is
  'The single place a clinic''s stat sheet is named. Replaces the spreadsheet id being pasted into 56 cloned Make scenarios, which is what made misdirected writes possible and invisible. Keyed on crm_location_id because that is what the booking webhook already sends. A row is only usable once verified_at is set - unverified rows are excluded from the export on purpose.';

comment on column pps_clinic_routing.spreadsheet_id is
  'Null means the clinic is known and its sheet is not. That is a gap to fill, never a reason to leave the row out.';

comment on column pps_clinic_routing.verified_at is
  'Until this is set the row does not reach the automation. Routing a practice''s patients into the wrong sheet on an unconfirmed name match would be worse than the problem this table replaces.';

create index if not exists pps_clinic_routing_sheet_idx
  on pps_clinic_routing (spreadsheet_id);

-- ---------------------------------------------------------------------------
-- What the automation reads.
--
-- Verified rows with a sheet, and nothing else. Deliberately narrow: two columns
-- and no nulls, so the consolidated scenario does a lookup and either gets an
-- answer or fails loudly. A scenario that receives a null sheet id and carries on
-- is how a booking disappears without an error.
--
-- Also excludes any sheet claimed by more than one clinic. If two practices
-- point at one file, sending bookings there would write both into it — the exact
-- fault being retired. Better that both fail visibly than one is silently wrong.
-- ---------------------------------------------------------------------------
create or replace view pps_routing_export as
with contested as (
  select spreadsheet_id
  from pps_clinic_routing
  where spreadsheet_id is not null
  group by spreadsheet_id
  having count(*) > 1
)
select r.crm_location_id, r.spreadsheet_id, r.practice
from pps_clinic_routing r
where r.verified_at is not null
  and r.spreadsheet_id is not null
  and r.spreadsheet_id not in (select spreadsheet_id from contested);

comment on view pps_routing_export is
  'Exactly what gets pushed to the Make data store: verified clinics with an uncontested sheet. A sheet claimed by two clinics is excluded rather than arbitrated, because guessing which one owns it is how bookings end up in the wrong practice.';

-- ---------------------------------------------------------------------------
-- Proposals, with their evidence.
--
-- Matches an active client to the sheet its audited scenario writes to, by name
-- similarity, and reports the score rather than acting on it. The scores matter
-- because the names genuinely diverge between the two systems - "Cruz
-- Orthodontics" against "Cruz Orthodontics LLC", "Art of Smile" against "Art Of
-- Smile: Center for Cosmetic Orthodontics", and "Airway Orthodontics - GNV"
-- against "TMJ Sleep Airway Orthodontics - Gainesville", which no similarity
-- measure will ever rank first.
--
-- So this is a shortlist for a person, not an answer.
-- ---------------------------------------------------------------------------
create or replace view pps_routing_candidates as
select
  c.id                                as client_id,
  c.name                              as practice,
  c.crm_location_id,
  p.scenario_id,
  p.folder                            as scenario_practice,
  p.primary_sheet_id                  as spreadsheet_id,
  round(similarity(c.name, p.folder)::numeric, 2) as name_similarity,
  -- The honest reading of the score. Anything below 'likely' needs a human to
  -- look at the practice, not a threshold to be nudged.
  case
    when similarity(c.name, p.folder) >= 0.85 then 'near-exact'
    when similarity(c.name, p.folder) >= 0.55 then 'likely'
    else 'needs a human'
  end                                 as confidence,
  exists (
    select 1 from pps_clinic_routing r where r.client_id = c.id
  )                                   as already_routed
from clients c
join scenario_primary_sheet p
  on similarity(c.name, p.folder) > 0.3
where c.is_active
  and c.crm_location_id is not null
order by c.name, similarity(c.name, p.folder) desc;

comment on view pps_routing_candidates is
  'Proposed clinic-to-sheet matches with a similarity score, for review. Never written to pps_clinic_routing automatically: the practice names in GoHighLevel and in Make diverge enough that a threshold would confidently mismatch a real clinic.';

-- ---------------------------------------------------------------------------
-- What is not routed yet.
--
-- Every active clinic with no usable routing row, and why. This is the list that
-- has to reach zero before the consolidated scenario can replace the clones, so
-- it is phrased as work rather than as a count.
-- ---------------------------------------------------------------------------
create or replace view pps_routing_gaps as
select
  c.id                as client_id,
  c.name              as practice,
  c.crm_location_id,
  case
    when c.crm_location_id is null
      then 'no GoHighLevel location id, so a booking cannot be matched to it'
    when r.client_id is null
      then 'no routing row yet'
    when r.spreadsheet_id is null
      then 'routing row exists but names no sheet'
    when r.verified_at is null
      then 'proposed but not verified, so deliberately not in use'
    else 'sheet is claimed by another clinic too'
  end                 as gap,
  (select count(*) from pps_routing_candidates k where k.client_id = c.id)
                      as candidates
from clients c
left join pps_clinic_routing r on r.client_id = c.id
where c.is_active
  and not exists (
    select 1 from pps_routing_export e
    where e.crm_location_id = c.crm_location_id
  )
order by c.name;

comment on view pps_routing_gaps is
  'Active clinics that the consolidated booking scenario could not route today, and the reason for each. Has to reach zero before the 56 cloned scenarios can be retired.';

-- ---------------------------------------------------------------------------
-- Everyone reads, only admins write. The sync uses the service role.
-- ---------------------------------------------------------------------------
alter table pps_clinic_routing enable row level security;

create policy pps_clinic_routing_read on pps_clinic_routing
  for select using (true);

create policy pps_clinic_routing_admin on pps_clinic_routing
  for all using (auth_is_admin()) with check (auth_is_admin());
