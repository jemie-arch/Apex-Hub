-- =============================================================================
-- 0001_init.sql — the complete schema.
--
-- This file alone rebuilds the database from a fresh clone. There is no 0002:
-- while the app is pre-launch, a schema change means editing this file and
-- rebuilding, so the file is always the whole truth.
--
-- The central distinction, and the one most easily got wrong:
--
--   client_groups  the BUSINESS. A dental practice. This is what "44 clients,
--                  100 by December" counts, what signs a retainer, and what
--                  logs into the portal.
--   clients        one GoHighLevel SUB-ACCOUNT. A business has one, or several
--                  when its locations are far enough apart to need their own
--                  area code for A2P. Bookings, ads and phone numbers live at
--                  this level.
--
-- Collapsing those two would make the headline client count wrong by however
-- many multi-sub-account practices exist, which is exactly the number the
-- company steers by.
--
-- Other conventions:
--   * money is integer cents, never float
--   * timestamps are timestamptz in UTC, rendered in the sub-account's zone
--   * external ids are unique so syncs upsert rather than insert
--   * show/no-show booleans are nullable: NULL means "not known yet". A sync
--     must never write false to mean "we have not heard".
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- The call centre has two distinct jobs and they are scored differently: an
-- ISR is measured on dials and bookings, a CSR on how calls are handled. Each
-- sees only their own page.
create type user_role as enum ('admin', 'isr', 'csr', 'client');

-- b2b = Apex selling retainers to practices. b2c = a practice booking patients.
-- Modelled in separate tables; this enum is the guard rail.
create type funnel as enum ('b2b', 'b2c');

create type client_status as enum ('onboarding', 'active', 'paused', 'churned');

create type appointment_status as enum (
  'scheduled', 'confirmed', 'showed', 'no_show', 'cancelled', 'rescheduled'
);

create type appointment_outcome as enum (
  'pending', 'quoted', 'won', 'lost', 'follow_up', 'unqualified'
);

create type deal_stage as enum (
  'new', 'contacted', 'call_booked', 'call_showed', 'proposal', 'won', 'lost'
);

create type call_direction as enum ('outbound', 'inbound');

create type call_outcome as enum (
  'connected', 'no_answer', 'voicemail', 'busy', 'wrong_number',
  'booked', 'not_interested'
);

create type task_status as enum ('open', 'in_progress', 'done', 'cancelled');

create type notification_kind as enum ('info', 'success', 'warning', 'error');

create type finance_kind as enum ('revenue', 'cost');

create type sync_status as enum ('running', 'success', 'partial', 'error');

create type sync_trigger as enum ('cron', 'cli', 'api', 'manual');

-- ---------------------------------------------------------------------------
-- Helpers
--
-- search_path is pinned on every function. Leaving it mutable lets anyone who
-- can create objects shadow a name the function resolves, and the auth_*
-- helpers are what every RLS policy calls to decide access.
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- Role and group scoping come from the JWT, so a policy never needs a table
-- lookup (which would recurse through user_profiles' own policies). The claims
-- are put there by mirror_profile_to_auth() below.
create or replace function auth_role()
returns user_role
language sql
stable
set search_path = public, pg_temp
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'role',
    'client'
  )::user_role;
$fn$;

create or replace function auth_is_admin()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $fn$
  select auth_role() = 'admin';
$fn$;

-- The BUSINESS a client login belongs to, not a sub-account.
create or replace function auth_group_id()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $fn$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'group_id',
    ''
  )::uuid;
$fn$;

-- `extensions` is on the path because pgcrypto lives there on Supabase, not in
-- public — without it gen_random_bytes does not resolve.
create or replace function generate_portal_token()
returns text
language sql
volatile
set search_path = public, extensions, pg_temp
as $fn$
  select replace(replace(encode(gen_random_bytes(24), 'base64'), '/', '_'), '+', '-');
$fn$;

-- ---------------------------------------------------------------------------
-- client_groups — the business. The unit the 100-client goal counts.
-- ---------------------------------------------------------------------------

create table client_groups (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  slug               text not null unique,
  status             client_status not null default 'onboarding',

  -- Column on the /onboarding board. Free text, not an enum: the stage list is
  -- editable and lives in app_settings under 'onboarding_stages'.
  onboarding_stage   text not null default 'signed',

  -- Billing is per business, however many sub-accounts it runs.
  retainer_cents     integer not null default 0 check (retainer_cents >= 0),
  currency           text not null default 'USD',

  -- What the practice actually sells. Ortho and general dentistry today.
  treatments         text[] not null default '{}',

  contact_name       text,
  contact_email      text,
  contact_phone      text,
  website            text,

  -- The portal is per business: one login shows every location's numbers.
  portal_token       text not null unique default generate_portal_token(),
  portal_enabled     boolean not null default true,

  signed_on          date,
  started_on         date,
  churned_on         date,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint client_groups_churned_needs_date
    check (status <> 'churned' or churned_on is not null)
);

create index client_groups_status_idx on client_groups (status);
create index client_groups_stage_idx on client_groups (onboarding_stage);

create trigger client_groups_set_updated_at
  before update on client_groups
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- clients — one GoHighLevel sub-account, belonging to a business.
-- ---------------------------------------------------------------------------

create table clients (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references client_groups (id) on delete cascade,

  -- Usually the location name. Distinct from the business name when a practice
  -- runs several sub-accounts.
  name               text not null,
  slug               text not null unique,

  -- GoHighLevel sub-account ("location"). One per row, and the reason a row
  -- exists at all.
  crm_location_id    text unique,
  -- Meta ad account id, stored without the act_ prefix.
  ad_account_id      text,

  -- IANA zone. Every patient-facing time renders here, not in the viewer's
  -- zone: a 9am appointment is 9am at the practice.
  timezone           text not null default 'UTC',

  -- Which of the practice's booking setups this sub-account uses. Free text:
  -- there are a handful in practice and the list is operational, not schema.
  scheduling_type    text,
  area_code          text,

  -- A sub-account can be switched off without the business churning.
  is_active          boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index clients_group_idx on clients (group_id);
create index clients_active_idx on clients (is_active);

create trigger clients_set_updated_at
  before update on clients
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- user_profiles — role + staff linkage, mirrored into auth metadata
-- ---------------------------------------------------------------------------

create table user_profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text not null unique,
  full_name       text,
  role            user_role not null default 'isr',

  -- Set only for role = 'client'; scopes that login to one business.
  client_group_id uuid references client_groups (id) on delete cascade,

  -- Links this person to their GoHighLevel user so synced calls and bookings
  -- attribute to the right person on the leaderboard.
  crm_user_id     text unique,

  /*
   * Menu permission keys. Two people can share the admin role and still see
   * different sidebars — a media buyer and a closer need different menus.
   *
   * NEVER RENAME A KEY. They are stored per user, so renaming one silently
   * revokes that page for everybody who had it. Menu labels are free to
   * change; the key behind a label is not.
   */
  permissions     text[] not null default '{}',

  -- Kept on the profile rather than in browser storage so the choice follows
  -- the person to a new device.
  theme           text not null default 'dark' check (theme in ('dark','light')),

  avatar_url      text,
  is_active       boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint user_profiles_client_role_requires_group
    check (role <> 'client' or client_group_id is not null),
  constraint user_profiles_staff_has_no_group
    check (role = 'client' or client_group_id is null)
);

create index user_profiles_role_idx on user_profiles (role);
create index user_profiles_group_idx on user_profiles (client_group_id);

create trigger user_profiles_set_updated_at
  before update on user_profiles
  for each row execute function set_updated_at();

-- Mirror role and group into auth.users.raw_app_meta_data so they ride in the
-- JWT, where middleware and RLS read them without a round trip.
create or replace function mirror_profile_to_auth()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
begin
  update auth.users
     set raw_app_meta_data =
           coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('role', new.role::text)
           || jsonb_build_object(
                'group_id', coalesce(new.client_group_id::text, '')
              )
   where id = new.id;
  return new;
end;
$fn$;

create trigger user_profiles_mirror_to_auth
  after insert or update of role, client_group_id on user_profiles
  for each row execute function mirror_profile_to_auth();

-- SECURITY DEFINER makes the function above reachable as a REST RPC. It is a
-- trigger function and must never be called directly, so EXECUTE is revoked.
--
-- All three revokes are required. Supabase's default privileges grant EXECUTE
-- to anon and authenticated EXPLICITLY, not merely through PUBLIC, so revoking
-- from PUBLIC alone leaves the function callable and the database linter still
-- flags it. Verified by re-running the linter after a rebuild.
--
-- The trigger is unaffected either way: it runs as the table owner, not as the
-- caller.
revoke execute on function mirror_profile_to_auth() from public;
revoke execute on function mirror_profile_to_auth() from anon;
revoke execute on function mirror_profile_to_auth() from authenticated;

-- ---------------------------------------------------------------------------
-- oauth_tokens — per sub-account CRM tokens, refreshed on read
-- ---------------------------------------------------------------------------

create table oauth_tokens (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,

  -- NULL means an agency-level token (GoHighLevel company scope) rather than
  -- one belonging to a single sub-account.
  client_id       uuid references clients (id) on delete cascade,

  crm_location_id text,
  access_token    text not null,
  refresh_token   text,
  expires_at      timestamptz,
  scope           text,

  -- Last refresh attempt and its failure, so a dead token is visible in
  -- /settings instead of only in a log nobody reads. refreshed_at doubles as
  -- the refresh lease: see lib/integrations/ghl.ts.
  refreshed_at    timestamptz,
  last_error      text,

  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One token per provider per sub-account, plus one agency-level token per
-- provider. Two partial indexes because UNIQUE treats NULLs as distinct.
create unique index oauth_tokens_provider_client_idx
  on oauth_tokens (provider, client_id)
  where client_id is not null;
create unique index oauth_tokens_provider_agency_idx
  on oauth_tokens (provider)
  where client_id is null;

create trigger oauth_tokens_set_updated_at
  before update on oauth_tokens
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- FUNNEL b2b — Apex selling to practices. Separate tables from appointments:
-- different lifecycle, different owner, different meaning of "converted".
-- ---------------------------------------------------------------------------

create table deals (
  id                  uuid primary key default gen_random_uuid(),
  funnel              funnel not null default 'b2b' check (funnel = 'b2b'),

  crm_opportunity_id  text unique,
  crm_contact_id      text,

  practice_name       text not null,
  contact_name        text,
  contact_email       text,
  contact_phone       text,

  stage               deal_stage not null default 'new',
  value_cents         integer check (value_cents is null or value_cents >= 0),
  currency            text not null default 'USD',

  owner_user_id       uuid references user_profiles (id) on delete set null,

  -- Set when the deal converts, tying this funnel to the business it created.
  client_group_id     uuid references client_groups (id) on delete set null,

  source              text,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  utm_content         text,
  utm_term            text,

  lost_reason         text,
  next_follow_up_at   timestamptz,
  first_contact_at    timestamptz,
  won_at              timestamptz,
  lost_at             timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  synced_at           timestamptz
);

create index deals_stage_idx on deals (stage);
create index deals_owner_idx on deals (owner_user_id);
create index deals_follow_up_idx on deals (next_follow_up_at)
  where next_follow_up_at is not null;
create index deals_group_idx on deals (client_group_id);

create trigger deals_set_updated_at
  before update on deals
  for each row execute function set_updated_at();

create table sales_calls (
  id                  uuid primary key default gen_random_uuid(),
  funnel              funnel not null default 'b2b' check (funnel = 'b2b'),

  deal_id             uuid not null references deals (id) on delete cascade,
  crm_appointment_id  text unique,

  scheduled_at        timestamptz not null,
  scheduled_end_at    timestamptz,
  status              appointment_status not null default 'scheduled',

  showed              boolean,
  outcome             appointment_outcome not null default 'pending',
  value_cents         integer check (value_cents is null or value_cents >= 0),

  -- Who booked it vs who ran it. The leaderboard needs both.
  set_by_user_id      uuid references user_profiles (id) on delete set null,
  closed_by_user_id   uuid references user_profiles (id) on delete set null,
  set_by_name         text,

  rescheduled_from    timestamptz,
  reschedule_count    integer not null default 0,

  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  synced_at           timestamptz
);

create index sales_calls_deal_idx on sales_calls (deal_id);
create index sales_calls_scheduled_idx on sales_calls (scheduled_at desc);
create index sales_calls_set_by_idx on sales_calls (set_by_user_id);
create index sales_calls_closed_by_idx on sales_calls (closed_by_user_id);

create trigger sales_calls_set_updated_at
  before update on sales_calls
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- FUNNEL b2c — a practice booking patients. One row per appointment.
-- ---------------------------------------------------------------------------

create table appointments (
  id                  uuid primary key default gen_random_uuid(),
  funnel              funnel not null default 'b2c' check (funnel = 'b2c'),

  -- The sub-account, not the business: calendars belong to sub-accounts.
  -- Business-level totals roll up through clients.group_id.
  client_id           uuid not null references clients (id) on delete cascade,

  crm_appointment_id  text unique,
  crm_contact_id      text,
  crm_calendar_id     text,

  patient_name        text,
  patient_email       text,
  patient_phone       text,
  address             text,

  scheduled_at        timestamptz not null,
  scheduled_end_at    timestamptz,

  status              appointment_status not null default 'scheduled',
  -- NULL = not known yet. Never write false to mean "no word back".
  showed              boolean,
  outcome             appointment_outcome not null default 'pending',

  -- Treatment value, usually typed by a human in the portal, so a sync must
  -- never null it back out.
  value_cents         integer check (value_cents is null or value_cents >= 0),

  booked_by_user_id   uuid references user_profiles (id) on delete set null,
  booked_by_name      text,
  booked_at           timestamptz,

  -- Attribution, carried from the ad that produced the lead.
  attribution_source  text,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  utm_content         text,
  utm_term            text,
  ad_external_id      text,
  campaign_external_id text,

  -- A reschedule updates this row rather than inserting a second one.
  rescheduled_from    timestamptz,
  reschedule_count    integer not null default 0,

  cancelled_at        timestamptz,
  notes               text,

  source              text not null default 'crm',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  synced_at           timestamptz
);

create index appointments_client_scheduled_idx
  on appointments (client_id, scheduled_at desc);
create index appointments_status_idx on appointments (status);
create index appointments_outcome_idx on appointments (outcome);
create index appointments_booked_by_idx on appointments (booked_by_user_id);
create index appointments_ad_idx on appointments (ad_external_id)
  where ad_external_id is not null;

create trigger appointments_set_updated_at
  before update on appointments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Ads. Ad accounts belong to sub-accounts, so everything here keys on clients.
-- ---------------------------------------------------------------------------

create table campaigns (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references clients (id) on delete cascade,
  platform              text not null default 'meta',
  external_id           text not null,
  name                  text not null,
  status                text,
  objective             text,
  daily_budget_cents    integer,
  lifetime_budget_cents integer,
  started_at            timestamptz,
  stopped_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  synced_at             timestamptz,

  unique (platform, external_id)
);

create index campaigns_client_idx on campaigns (client_id);

create trigger campaigns_set_updated_at
  before update on campaigns
  for each row execute function set_updated_at();

-- Ad identity, so /ads can group business -> sub-account -> campaign -> ad and
-- ad_level_insights has a stable parent. Note that a relaunched ad reuses its
-- name under a NEW external id, so name is not identity.
create table ads (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references clients (id) on delete cascade,
  campaign_id        uuid references campaigns (id) on delete set null,
  platform           text not null default 'meta',
  external_id        text not null,
  adset_external_id  text,
  name               text not null,
  status             text,
  creative_thumb_url text,
  preview_url        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  synced_at          timestamptz,

  unique (platform, external_id)
);

create index ads_client_idx on ads (client_id);
create index ads_campaign_idx on ads (campaign_id);
create index ads_name_idx on ads (client_id, name);

create trigger ads_set_updated_at
  before update on ads
  for each row execute function set_updated_at();

-- Daily per-sub-account rollup. Drives spend trends without summing thousands
-- of per-ad rows.
create table ad_snapshots (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients (id) on delete cascade,
  platform    text not null default 'meta',
  snapshot_on date not null,

  spend_cents integer not null default 0,
  impressions integer not null default 0,
  clicks      integer not null default 0,
  -- The ad platform's own lead count, which is zero on accounts whose forms
  -- live in the CRM. Real lead volume comes from appointments, not here.
  leads       integer not null default 0,
  reach       integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (client_id, platform, snapshot_on)
);

create index ad_snapshots_date_idx on ad_snapshots (snapshot_on desc);

create trigger ad_snapshots_set_updated_at
  before update on ad_snapshots
  for each row execute function set_updated_at();

-- One row per ad per day: the grain behind /ads-performance.
create table ad_level_insights (
  id          uuid primary key default gen_random_uuid(),
  ad_id       uuid not null references ads (id) on delete cascade,
  client_id   uuid not null references clients (id) on delete cascade,
  campaign_id uuid references campaigns (id) on delete set null,
  insight_on  date not null,

  spend_cents integer not null default 0,
  impressions integer not null default 0,
  clicks      integer not null default 0,
  leads       integer not null default 0,
  reach       integer not null default 0,
  frequency   numeric(8, 4),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (ad_id, insight_on)
);

create index ad_level_insights_client_date_idx
  on ad_level_insights (client_id, insight_on desc);

create trigger ad_level_insights_set_updated_at
  before update on ad_level_insights
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Call centre
-- ---------------------------------------------------------------------------

-- Dial logs. Volume and handling data for the leaderboards, not transcripts.
create table calls (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references user_profiles (id) on delete set null,
  client_id        uuid references clients (id) on delete set null,
  deal_id          uuid references deals (id) on delete set null,

  crm_call_id      text unique,
  crm_user_id      text,
  contact_name     text,
  contact_phone    text,

  direction        call_direction not null default 'outbound',
  outcome          call_outcome,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  started_at       timestamptz not null,
  recording_url    text,

  -- Set by the AI audit. Kept nullable: an unscored call is not a zero-scored
  -- call, and the two must not average together.
  quality_score    numeric(4, 1) check (quality_score is null
                     or (quality_score >= 0 and quality_score <= 10)),

  created_at       timestamptz not null default now(),
  synced_at        timestamptz
);

create index calls_user_started_idx on calls (user_id, started_at desc);
create index calls_started_idx on calls (started_at desc);
create index calls_client_idx on calls (client_id);

-- Transcript plus AI summary. Attached to a business or to a b2b lead.
create table call_recordings (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null,
  external_id      text not null,

  client_group_id  uuid references client_groups (id) on delete set null,
  deal_id          uuid references deals (id) on delete set null,

  title            text,
  recorded_at      timestamptz not null,
  duration_seconds integer,
  recording_url    text,
  transcript       text,
  ai_summary       text,
  ai_action_items  jsonb not null default '[]'::jsonb,
  participants     jsonb not null default '[]'::jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  synced_at        timestamptz,

  unique (provider, external_id),
  constraint call_recordings_one_owner
    check (client_group_id is null or deal_id is null)
);

create index call_recordings_group_idx on call_recordings (client_group_id);
create index call_recordings_deal_idx on call_recordings (deal_id);
create index call_recordings_recorded_idx on call_recordings (recorded_at desc);

create trigger call_recordings_set_updated_at
  before update on call_recordings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Account management: forms, notes, tasks. All per business.
-- ---------------------------------------------------------------------------

create table form_submissions (
  id                uuid primary key default gen_random_uuid(),
  client_group_id   uuid references client_groups (id) on delete cascade,
  client_id         uuid references clients (id) on delete cascade,
  deal_id           uuid references deals (id) on delete cascade,

  -- 'onboarding', 'kickoff' (the CSM form), or whatever else gets built.
  form_key          text not null,
  crm_submission_id text unique,
  payload           jsonb not null default '{}'::jsonb,
  submitted_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index form_submissions_group_idx on form_submissions (client_group_id);
create index form_submissions_key_idx on form_submissions (form_key);

create table client_notes (
  id              uuid primary key default gen_random_uuid(),
  client_group_id uuid not null references client_groups (id) on delete cascade,
  author_user_id  uuid references user_profiles (id) on delete set null,
  author_name     text,
  body            text not null,
  pinned          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index client_notes_group_created_idx
  on client_notes (client_group_id, created_at desc);

create trigger client_notes_set_updated_at
  before update on client_notes
  for each row execute function set_updated_at();

create table client_tasks (
  id                uuid primary key default gen_random_uuid(),
  client_group_id   uuid not null references client_groups (id) on delete cascade,
  title             text not null,
  detail            text,
  status            task_status not null default 'open',
  due_on            date,
  assignee_user_id  uuid references user_profiles (id) on delete set null,

  -- 'manual', or 'ai_call' when extracted from a recording.
  source            text not null default 'manual',
  call_recording_id uuid references call_recordings (id) on delete set null,

  -- When an SLA clock started, so a breach is measurable rather than felt.
  sla_due_at        timestamptz,

  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index client_tasks_group_status_idx
  on client_tasks (client_group_id, status);
create index client_tasks_assignee_idx on client_tasks (assignee_user_id);
create index client_tasks_sla_idx on client_tasks (sla_due_at)
  where sla_due_at is not null and completed_at is null;

create trigger client_tasks_set_updated_at
  before update on client_tasks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- notifications — in-app nudges
-- ---------------------------------------------------------------------------

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references user_profiles (id) on delete cascade,
  kind       notification_kind not null default 'info',
  title      text not null,
  body       text,
  href       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx
  on notifications (user_id, created_at desc)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- finance_entries — revenue and cost lines, per business
-- ---------------------------------------------------------------------------

create table finance_entries (
  id              uuid primary key default gen_random_uuid(),
  client_group_id uuid references client_groups (id) on delete set null,
  kind            finance_kind not null,
  category        text not null,
  amount_cents    integer not null,
  currency        text not null default 'USD',
  occurred_on     date not null,
  memo            text,

  -- Set when a line came from an integration rather than a human, so imports
  -- upsert instead of duplicating.
  source          text not null default 'manual',
  external_id     text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index finance_entries_source_external_idx
  on finance_entries (source, external_id)
  where external_id is not null;
create index finance_entries_occurred_idx on finance_entries (occurred_on desc);
create index finance_entries_group_idx on finance_entries (client_group_id);

create trigger finance_entries_set_updated_at
  before update on finance_entries
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- app_settings — key/value runtime config, editable by admin
-- ---------------------------------------------------------------------------

create table app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references user_profiles (id) on delete set null
);

create trigger app_settings_set_updated_at
  before update on app_settings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- sync_runs — one row per sync job
-- ---------------------------------------------------------------------------

create table sync_runs (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  status          sync_status not null default 'running',
  triggered_by    sync_trigger not null default 'cron',

  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  duration_ms     integer,

  records_read    integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  records_skipped integer not null default 0,
  error_count     integer not null default 0,
  errors          jsonb not null default '[]'::jsonb,
  meta            jsonb not null default '{}'::jsonb,

  -- Set when a run covers a single sub-account rather than all of them.
  client_id       uuid references clients (id) on delete set null
);

create index sync_runs_name_started_idx on sync_runs (name, started_at desc);
create index sync_runs_status_idx on sync_runs (status);

-- ---------------------------------------------------------------------------
-- Billing
--
-- What Apex actually charged its clients, mirrored from Stripe. Separate from
-- finance_entries on purpose: that table is a hand-kept ledger of money that
-- moved, this one is a faithful copy of an external system.
--
-- Keyed on the Stripe payment intent, so re-syncing cannot double-count and a
-- retry of the same consult lands as its own row rather than overwriting the
-- first attempt. That sequence is the evidence: it is how you see whether the
-- retry logic carried an unpaid consult forward or quietly dropped it.
-- ---------------------------------------------------------------------------

create type billing_outcome as enum ('succeeded', 'failed', 'pending', 'canceled');

-- One row per Stripe customer. A practice can have more than one, and when it
-- does the same consults get billed twice — so duplicates stay visible rather
-- than being merged away.
create table billing_customers (
  stripe_customer_id text primary key,
  client_id          uuid references clients (id) on delete set null,
  group_id           uuid references client_groups (id) on delete set null,

  -- Stripe customers are named after the practice owner more often than the
  -- practice, so most cannot be matched automatically.
  name               text,
  email              text,

  -- Set when a human confirms the mapping, so a fuzzy guess and a known fact
  -- are never mistaken for each other — and so the next sync leaves it alone.
  mapped_by_hand     boolean not null default false,

  first_seen_at      timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index billing_customers_client_idx on billing_customers (client_id);
create index billing_customers_email_idx  on billing_customers (lower(email));

create table billing_charges (
  stripe_payment_intent_id text primary key,
  stripe_customer_id       text references billing_customers (stripe_customer_id) on delete set null,

  -- Denormalised from billing_customers so a charge stays attributable if the
  -- mapping is later corrected, and so the page groups without a join.
  client_id                uuid references clients (id) on delete set null,

  amount_cents             bigint not null,
  currency                 text   not null default 'usd',

  -- Our answer to "was this charged?", alongside Stripe's own wording.
  -- 'requires_payment_method' means the card was declined and nothing was
  -- collected; that nuance is worth keeping rather than flattening.
  outcome                  billing_outcome not null,
  stripe_status            text not null,

  error_code               text,
  decline_code             text,
  error_message            text,

  description              text,

  -- Parsed from the "[ADM] Consults charged:" description. This is what makes a
  -- failed charge actionable: it names the patients that went unbilled.
  consult_names            text[] not null default '{}',
  consult_count            integer not null default 0,

  stripe_invoice_id        text,
  occurred_at              timestamptz not null,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  synced_at                timestamptz not null default now()
);

create index billing_charges_occurred_idx on billing_charges (occurred_at desc);
create index billing_charges_client_idx   on billing_charges (client_id, occurred_at desc);
create index billing_charges_customer_idx on billing_charges (stripe_customer_id);

-- Partial: the failures are what anyone queries for, and they are the minority.
create index billing_charges_outcome_idx on billing_charges (outcome)
  where outcome <> 'succeeded';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- The service-role key bypasses all of this, and API routes use it
-- deliberately. These policies exist so a leaked or misused anon key still
-- cannot read across the tenancy boundary. Route authorisation is middleware's
-- job, not theirs.
--
-- Portal traffic is not covered here: /portal/[token] is unauthenticated and
-- is served through API routes that resolve the token under the service role
-- and scope the query themselves.
-- ---------------------------------------------------------------------------

alter table client_groups     enable row level security;
alter table clients           enable row level security;
alter table user_profiles     enable row level security;
alter table oauth_tokens      enable row level security;
alter table deals             enable row level security;
alter table sales_calls       enable row level security;
alter table appointments      enable row level security;
alter table campaigns         enable row level security;
alter table ads               enable row level security;
alter table ad_snapshots      enable row level security;
alter table ad_level_insights enable row level security;
alter table calls             enable row level security;
alter table call_recordings   enable row level security;
alter table form_submissions  enable row level security;
alter table client_notes      enable row level security;
alter table client_tasks      enable row level security;
alter table notifications     enable row level security;
alter table finance_entries   enable row level security;
alter table app_settings      enable row level security;
alter table sync_runs         enable row level security;
alter table billing_customers enable row level security;
alter table billing_charges   enable row level security;

create policy admin_all on client_groups     for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on clients           for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on user_profiles     for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on oauth_tokens      for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on deals             for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on sales_calls       for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on appointments      for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on campaigns         for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on ads               for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on ad_snapshots      for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on ad_level_insights for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on calls             for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on call_recordings   for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on form_submissions  for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on client_notes      for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on client_tasks      for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on notifications     for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on finance_entries   for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on app_settings      for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on sync_runs         for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on billing_customers for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on billing_charges   for all using (auth_is_admin()) with check (auth_is_admin());

-- Anyone signed in reads their own profile row, and only that row.
create policy self_read on user_profiles
  for select using (id = auth.uid());

-- ISRs and CSRs see their own performance and nothing about a colleague.
create policy staff_own_calls on calls
  for select using (
    auth_role() in ('isr', 'csr') and user_id = auth.uid()
  );

create policy staff_own_sales_calls on sales_calls
  for select using (
    auth_role() in ('isr', 'csr')
    and (set_by_user_id = auth.uid() or closed_by_user_id = auth.uid())
  );

create policy staff_own_appointments on appointments
  for select using (
    auth_role() in ('isr', 'csr') and booked_by_user_id = auth.uid()
  );

create policy staff_own_deals on deals
  for select using (auth_role() in ('isr', 'csr') and owner_user_id = auth.uid());

create policy own_notifications on notifications
  for select using (user_id = auth.uid());

create policy own_notifications_update on notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A client login reaches its own business, its sub-accounts, and their b2c
-- records. Nothing else.
create policy client_own_group on client_groups
  for select using (auth_role() = 'client' and id = auth_group_id());

create policy client_own_clients on clients
  for select using (auth_role() = 'client' and group_id = auth_group_id());

create policy client_own_appointments on appointments
  for select using (
    auth_role() = 'client'
    and client_id in (select id from clients where group_id = auth_group_id())
  );

create policy client_own_appointments_update on appointments
  for update using (
    auth_role() = 'client'
    and client_id in (select id from clients where group_id = auth_group_id())
  )
  with check (
    auth_role() = 'client'
    and client_id in (select id from clients where group_id = auth_group_id())
  );

create policy client_own_snapshots on ad_snapshots
  for select using (
    auth_role() = 'client'
    and client_id in (select id from clients where group_id = auth_group_id())
  );

-- ---------------------------------------------------------------------------
-- Seed: runtime config only. No fabricated business data.
-- ---------------------------------------------------------------------------

insert into app_settings (key, value, description) values
  (
    'onboarding_stages',
    -- The 14-step launch sequence, payment through to live ads.
    '["payment","kickoff_call_booked","welcome_email_sent","onboarding_form_filled",
      "kickoff_call","tech_setup_call","ad_scripts","crm_setup","a2p_approved",
      "content_in","editing","ads_set_up","launch_call","live"]'::jsonb,
    'Ordered columns for the onboarding board — the 14-step launch sequence.'
  ),
  (
    'sync_enabled',
    '{"crm":true,"ads":true,"calls":true}'::jsonb,
    'Kill switch per integration. A disabled sync records a skipped run.'
  ),
  (
    'attribution_window_days',
    '30'::jsonb,
    'How far back an appointment may be attributed to an ad click.'
  ),
  (
    'default_currency',
    '"USD"'::jsonb,
    'Currency used when a business has none set.'
  ),
  (
    'hero_metric',
    '"clients_toward_goal"'::jsonb,
    'Which number renders outsized on /dashboard.'
  ),
  (
    'client_goal',
    '{"target":100,"deadline":"2026-12-01"}'::jsonb,
    'The growth target the hero metric measures against.'
  );


-- ---------------------------------------------------------------------------
-- The five pages the sidebar showed as "soon": Leads, B2B Ads Tracker,
-- Projects, Team and Tech Support.
--
-- Everything here is human-owned. None of it is a mirror of a CRM object, so
-- no sync may overwrite it; where a row can also arrive from an integration it
-- carries source + external_id and upserts on those, the same shape used by
-- finance_entries.
-- ---------------------------------------------------------------------------

create type lead_classification as enum (
  'unclassified', 'qualified', 'unqualified', 'nurture', 'duplicate', 'spam'
);

create type project_status as enum (
  'idea', 'planned', 'in_progress', 'blocked', 'done', 'cancelled'
);

create type time_off_kind as enum (
  'vacation', 'sick', 'unpaid', 'parental', 'other'
);

create type request_status as enum ('pending', 'approved', 'declined', 'cancelled');

create type tech_call_status as enum (
  'requested', 'confirmed', 'completed', 'cancelled', 'no_show'
);

-- ---------------------------------------------------------------------------
-- b2b_leads — inbound leads for the agency's OWN advertising
--
-- Distinct from `deals`: a lead is somebody who raised a hand, a deal is a
-- practice we are actively selling. A lead is promoted to a deal, and the link
-- is kept so the funnel can be read end to end.
-- ---------------------------------------------------------------------------
create table b2b_leads (
  id             uuid primary key default gen_random_uuid(),

  -- What the person told us. All three are optional individually, but a row
  -- with none of them identifies nobody: see the check below.
  name           text,
  email          text,
  phone          text,
  practice_name  text,

  -- Where they came from. `channel` is the ad platform or 'manual'.
  channel        text not null default 'manual',
  campaign_name  text,
  ad_name        text,

  classification lead_classification not null default 'unclassified',

  -- Set when this lead became a real opportunity.
  deal_id        uuid references deals (id) on delete set null,

  owner_user_id  uuid references user_profiles (id) on delete set null,
  notes          text,

  -- Present when the lead came from the CRM rather than being typed in.
  crm_contact_id text,
  source         text not null default 'manual',
  external_id    text,

  received_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  /*
   * A lead with no name, no email and no phone is not a lead — it is an empty
   * form submission. Rejected at write time rather than filtered at read time,
   * so the same blank row cannot arrive twice by two different routes.
   */
  constraint b2b_leads_identifiable check (
    coalesce(nullif(trim(name), ''), nullif(trim(email), ''),
             nullif(trim(phone), '')) is not null
  )
);

create unique index b2b_leads_source_external_idx
  on b2b_leads (source, external_id)
  where external_id is not null;
create unique index b2b_leads_crm_contact_idx
  on b2b_leads (crm_contact_id)
  where crm_contact_id is not null;
create index b2b_leads_received_idx on b2b_leads (received_at desc);
create index b2b_leads_classification_idx on b2b_leads (classification);

create trigger b2b_leads_set_updated_at
  before update on b2b_leads
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- b2b_ad_days — per-ad economics for the agency's own advertising
--
-- One row per ad per day, which is the grain every derived figure needs: cost
-- per lead, cost per booking, show rate, cost per qualified call and ROAS are
-- all ratios of these columns and are therefore NOT stored. Storing a ratio
-- would let it disagree with its own numerator.
-- ---------------------------------------------------------------------------
create table b2b_ad_days (
  id                 uuid primary key default gen_random_uuid(),
  day                date not null,
  platform           text not null default 'meta',
  campaign_name      text not null,
  ad_name            text not null default '(all ads)',

  spend_cents        integer not null default 0,
  impressions        integer not null default 0,
  clicks             integer not null default 0,

  leads              integer not null default 0,
  bookings           integer not null default 0,
  showed             integer not null default 0,
  qualified_calls    integer not null default 0,
  closed             integer not null default 0,
  cash_collected_cents integer not null default 0,

  currency           text not null default 'USD',
  source             text not null default 'manual',
  external_id        text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Idempotent by the natural key, so a re-import corrects a day instead of
  -- doubling it.
  constraint b2b_ad_days_grain unique (day, platform, campaign_name, ad_name)
);

create index b2b_ad_days_day_idx on b2b_ad_days (day desc);

create trigger b2b_ad_days_set_updated_at
  before update on b2b_ad_days
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- projects + project_notes — the internal board
-- ---------------------------------------------------------------------------
create table projects (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  summary       text,
  status        project_status not null default 'idea',

  owner_user_id uuid references user_profiles (id) on delete set null,

  -- Set when the project is for one client rather than for the agency.
  client_group_id uuid references client_groups (id) on delete set null,

  due_on        date,
  -- Ordering within a column, so the board is not stuck in date order.
  position      integer not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index projects_status_idx on projects (status, position);
create index projects_group_idx on projects (client_group_id);

create trigger projects_set_updated_at
  before update on projects
  for each row execute function set_updated_at();

create table project_notes (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects (id) on delete cascade,
  author_user_id uuid references user_profiles (id) on delete set null,
  body           text not null,
  created_at     timestamptz not null default now()
);

create index project_notes_project_idx on project_notes (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Team — employment facts live on the profile; requests are their own table
-- ---------------------------------------------------------------------------
alter table user_profiles
  add column if not exists job_title  text,
  add column if not exists started_on date,
  add column if not exists timezone   text;

create table time_off_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references user_profiles (id) on delete cascade,
  kind           time_off_kind not null default 'vacation',

  starts_on      date not null,
  ends_on        date not null,
  note           text,

  status         request_status not null default 'pending',
  decided_by     uuid references user_profiles (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint time_off_dates_ordered check (ends_on >= starts_on)
);

create index time_off_user_idx on time_off_requests (user_id, starts_on desc);
create index time_off_status_idx on time_off_requests (status, starts_on);

create trigger time_off_requests_set_updated_at
  before update on time_off_requests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- tech_calls — clinic tech-support bookings, confirmed from the Hub
-- ---------------------------------------------------------------------------
create table tech_calls (
  id                 uuid primary key default gen_random_uuid(),

  -- The BUSINESS, plus optionally which sub-account it came through.
  client_group_id    uuid references client_groups (id) on delete cascade,
  client_id          uuid references clients (id) on delete set null,

  requested_by       text,
  contact_email      text,
  contact_phone      text,
  topic              text not null,
  detail             text,

  requested_at       timestamptz not null default now(),
  scheduled_at       timestamptz,

  status             tech_call_status not null default 'requested',
  confirmed_by       uuid references user_profiles (id) on delete set null,
  confirmed_at       timestamptz,
  resolution         text,

  -- Set when the booking also exists as a CRM calendar event.
  crm_appointment_id text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index tech_calls_crm_appointment_idx
  on tech_calls (crm_appointment_id)
  where crm_appointment_id is not null;
create index tech_calls_status_idx on tech_calls (status, requested_at desc);
create index tech_calls_group_idx on tech_calls (client_group_id);

create trigger tech_calls_set_updated_at
  before update on tech_calls
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Every table is closed by default; the app reads through the service
-- role in server code, and these policies cover a signed-in browser client.
-- ---------------------------------------------------------------------------
alter table b2b_leads         enable row level security;
alter table b2b_ad_days       enable row level security;
alter table projects          enable row level security;
alter table project_notes     enable row level security;
alter table time_off_requests enable row level security;
alter table tech_calls        enable row level security;

create policy admin_all on b2b_leads         for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on b2b_ad_days       for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on projects          for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on project_notes     for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on time_off_requests for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on tech_calls        for all using (auth_is_admin()) with check (auth_is_admin());

-- Anybody signed in reads and raises their own time off, and nobody else's.
create policy self_read on time_off_requests
  for select using (user_id = auth.uid());

create policy self_insert on time_off_requests
  for insert with check (user_id = auth.uid() and status = 'pending');


-- ---------------------------------------------------------------------------
-- Practice details the clinic maintains itself through the portal.
--
-- Deliberately on the BUSINESS rather than the sub-account: an address belongs
-- to the practice, not to a CRM location record. No sync writes these columns,
-- so a correction typed by the clinic cannot be overwritten by an import.
-- ---------------------------------------------------------------------------
alter table client_groups
  add column if not exists address_line1      text,
  add column if not exists address_line2      text,
  add column if not exists city               text,
  add column if not exists region             text,
  add column if not exists postal_code        text,
  add column if not exists country            text,
  -- Free text per day rather than a structured range: practices write things
  -- like "8-1, 2-5 (closed alt Fridays)", and a start/end pair cannot hold it.
  add column if not exists opening_hours      jsonb not null default '{}'::jsonb,
  add column if not exists details_updated_at timestamptz;


-- ---------------------------------------------------------------------------
-- The two things only the clinic knows, alongside the outcome and the value.
--
-- No sync writes these columns, which is what makes them worth the clinic
-- typing: an import cannot undo the answer.
-- ---------------------------------------------------------------------------
create type lead_quality as enum ('high', 'medium', 'low', 'unusable');

alter table appointments
  add column if not exists financing_approved  boolean,
  add column if not exists lead_quality        lead_quality,
  -- When the clinic last told us something about this appointment. Distinct
  -- from updated_at, which any sync touch bumps.
  add column if not exists outcome_updated_at  timestamptz;


-- ---------------------------------------------------------------------------
-- Who said whether the patient attended.
--
-- Attendance is the one field both sides report: the CRM records it when
-- practice staff mark the appointment, and the clinic records it in the
-- portal. This column makes the answer's origin explicit so the sync can
-- defer to the clinic — they were in the room. See crm-appointments.ts.
-- ---------------------------------------------------------------------------
alter table appointments
  add column if not exists showed_source text
    check (showed_source is null or showed_source in ('crm', 'client'));


-- ===========================================================================
-- TRACKER IMPORT
--
-- The Client Fulfilment Tracker spreadsheet, brought across as history.
--
-- These live in their own tables rather than in `appointments` and `leads`
-- because a sheet row carries no GoHighLevel appointment id. Merging them into
-- the synced tables would create a second population that can never be deduped
-- against the live sync — every re-sync would look like new bookings. Kept apart,
-- they can be reconciled on name and date, and the reconciliation can be wrong
-- without corrupting anything.
--
-- Worth importing for one reason above the others: the sheet has campaign ids on
-- almost every row and the synced appointments have them on none, so this is
-- currently the only place ad spend can be joined to a booking.
-- ===========================================================================

create table tracker_appointments (
  id                   uuid primary key default gen_random_uuid(),

  -- Row number in the sheet. The natural key, so re-importing corrects a row
  -- rather than duplicating it — the sheet has no id of its own.
  source_row           integer not null unique,

  -- The practice as the sheet spells it, kept verbatim. client_id is the match
  -- we made, and stays null when the name matched nothing rather than guessing.
  location_name        text not null,
  client_id            uuid references clients (id) on delete set null,

  patient_name         text,
  patient_email        text,

  -- Two dates that are easy to conflate: when the lead came in, and when the
  -- appointment is actually for.
  created_on           date,
  booked_for           date,

  campaign_external_id text,
  adset_external_id    text,
  ad_external_id       text,
  offer_name           text,

  -- Free text, straight from the sheet. Deliberately not the appointment_status
  -- enum: the sheet holds values that enum has no room for, and coercing them
  -- would lose the thing worth importing.
  appointment_status   text,
  status_if_showed     text,

  amount_spent_cents   integer,

  imported_at          timestamptz not null default now()
);

create index tracker_appointments_client_idx on tracker_appointments (client_id);
create index tracker_appointments_booked_idx on tracker_appointments (booked_for desc);
create index tracker_appointments_campaign_idx on tracker_appointments (campaign_external_id)
  where campaign_external_id is not null;

create table tracker_leads (
  id                   uuid primary key default gen_random_uuid(),
  source_row           integer not null unique,

  company_name         text not null,
  client_id            uuid references clients (id) on delete set null,

  received_on          date,
  lead_name            text,

  -- The sheet's own count column. Usually 1; occasionally a row stands for
  -- several, which is why it is stored rather than assumed.
  lead_count           integer,

  -- Both ids and names, because the sheet has both and the names are what makes
  -- a report readable without a second lookup.
  campaign_external_id text,
  campaign_name        text,
  adset_external_id    text,
  adset_name           text,
  ad_external_id       text,
  ad_name              text,

  imported_at          timestamptz not null default now()
);

create index tracker_leads_client_idx on tracker_leads (client_id);
create index tracker_leads_received_idx on tracker_leads (received_on desc);
create index tracker_leads_campaign_idx on tracker_leads (campaign_external_id)
  where campaign_external_id is not null;

alter table tracker_appointments enable row level security;
alter table tracker_leads        enable row level security;

create policy admin_all on tracker_appointments for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on tracker_leads        for all using (auth_is_admin()) with check (auth_is_admin());


-- ===========================================================================
-- ONBOARDING FORM SUBMISSIONS
--
-- The onboarding forms live in a GoHighLevel sub-account of their own (ADM
-- Client Onboarding Account), and their submissions arrive almost anonymous:
-- the practice's answers are stored against 20-character custom-field ids, so
-- the payload looks like it holds no name and no company. It holds both. The
-- clinic name is under "Clinic Friendly Name" or "Clinic Name" on 139 of 141
-- submissions; the person's name usually is not, and comes from the contact
-- record instead — the onboarding sub-account first, then the sales sub-account
-- matched on email or phone.
--
-- These columns record not just what was resolved but how, because a name
-- arrived at by matching a phone number is a weaker fact than one typed on the
-- form, and a reader deserves to know which they are looking at.
-- ===========================================================================

alter table form_submissions
  -- Which sub-account the form belongs to. Not a client: these are Apex's own.
  add column source_location_id  text,

  -- The practice as the form spells it, kept verbatim so a bad match can be
  -- re-judged later against what was actually typed.
  add column clinic_name         text,

  add column contact_crm_id      text,
  add column person_name         text,
  add column contact_email       text,
  add column contact_phone       text,

  -- Stated by the practice on its own onboarding form, which makes it better
  -- evidence than the billing sync's name-guessing.
  add column stripe_customer_id  text,

  -- How client_group_id was arrived at: 'exact', 'contains', 'ambiguous',
  -- 'suggested', 'none', 'no_clinic_name' or 'test_data'. Only 'exact' and
  -- 'contains' set client_group_id; the rest leave it null on purpose. A
  -- clinic name matching several groups equally is recorded as 'ambiguous'
  -- rather than resolved by picking the longest, which is a coin toss wearing
  -- the costume of a match.
  add column match_method        text,

  -- Where person_name came from: 'onboarding' or 'sales_account'.
  add column name_source         text,

  -- The closest group when nothing was confident enough to link. A prompt for
  -- a human, never used as if it were a match.
  add column suggested_group_id  uuid references client_groups (id) on delete set null,

  -- Staff testing the form. Kept rather than deleted, so counts reconcile with
  -- GoHighLevel, but excluded from anything that reads as a client.
  add column is_test             boolean not null default false;

create index form_submissions_submitted_idx on form_submissions (submitted_at desc);
create index form_submissions_clinic_idx on form_submissions (lower(clinic_name));


-- ===========================================================================
-- ROLES: PRIVILEGE VERSUS JOB
--
-- super_admin is a privilege level. ceo, tech, media_buyer, isa and csm are job
-- titles and carry no reach of their own — what each person sees is their
-- permission keys. Conflating the two would mean the only way to grant somebody
-- the finance page is to make them chief executive.
--
-- READ THIS BEFORE ADDING A ROLE. The middleware ends with a blanket 404 for any
-- staff role it has no rule for. Assigning 'super_admin' in the database before
-- the code that recognised it was deployed returned Not found on every path for
-- that account — the site was up, the owner's login was dead. A new role must be
-- added to PRIVILEGED_ROLES in src/config/roles.ts, or handled explicitly in
-- middleware, and DEPLOYED, before it is given to anybody.
--
-- isr and csr are the former names for isa and csm. Enum values cannot be
-- dropped while rows reference them, so both remain and are labelled legacy.
-- ===========================================================================

alter type user_role add value if not exists 'super_admin';
alter type user_role add value if not exists 'ceo';
alter type user_role add value if not exists 'tech';
alter type user_role add value if not exists 'media_buyer';
alter type user_role add value if not exists 'isa';
alter type user_role add value if not exists 'csm';

-- One edit rather than forty: every policy already routes through this, so
-- widening it grants the new privilege level across every table at once.
create or replace function auth_is_admin()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $fn$
  select auth_role() in ('admin', 'super_admin');
$fn$;


-- ===========================================================================
-- CLIENT ONBOARDING BOARD
--
-- Six columns, of which only two are opinions. new_signup, onboarding_form and
-- kickoff_form are facts about which form exists; launch_ready is a fact about
-- the checklist. Only waiting_on_team and waiting_on_client are set by a person,
-- which is why this is not a drag-anywhere board — moving a card by hand would
-- make it disagree with the filing cabinet.
--
-- The checklist lives in onboarding_step_template rather than in code, because
-- the team will reword and reorder it, and because "launch ready means every
-- active step is done" is a rule the database can only apply if it knows the
-- steps.
-- ===========================================================================

create type onboarding_status as enum (
  'new_signup', 'onboarding_form', 'kickoff_form',
  'waiting_on_team', 'waiting_on_client', 'launch_ready'
);

alter table client_groups
  add column onboarding_status onboarding_status not null default 'new_signup',
  add column csm_user_id uuid references user_profiles (id) on delete set null,
  -- Both come from the ADM Client Onboarding sub-account's calendars, not from
  -- anything typed here.
  add column onboarding_call_at timestamptz,
  add column launch_call_at timestamptz,
  add column onboarding_added_at timestamptz not null default now(),
  -- Compared against the newest form, so an arriving form can overtake a manual
  -- hold but a stale form cannot.
  add column status_set_manually_at timestamptz,
  add column status_set_by uuid references user_profiles (id) on delete set null;

create index client_groups_onboarding_status_idx on client_groups (onboarding_status);
create index client_groups_csm_idx on client_groups (csm_user_id);

create table onboarding_step_template (
  step_key    text primary key,
  group_key   text not null,
  group_label text not null,
  label       text not null,
  -- Intended to be done by a script. Recorded so the board can admit which
  -- steps are still waiting on automation that does not exist, rather than
  -- quietly presenting them as ordinary manual work.
  automated   boolean not null default false,
  sort_order  integer not null,
  is_active   boolean not null default true
);

-- One row per step a client has progressed. Absent means not started.
create table onboarding_step_state (
  client_group_id uuid not null references client_groups (id) on delete cascade,
  step_key        text not null,
  done_at         timestamptz,
  done_by         uuid references user_profiles (id) on delete set null,
  note            text,
  -- Where the ads copy step puts what the client reviews in their portal.
  asset_url       text,
  updated_at      timestamptz not null default now(),
  primary key (client_group_id, step_key)
);

create index onboarding_step_state_group_idx on onboarding_step_state (client_group_id);

-- Append-only. A status that changed with no record of who changed it is the
-- thing this board exists to stop.
create table onboarding_activity (
  id              uuid primary key default gen_random_uuid(),
  client_group_id uuid not null references client_groups (id) on delete cascade,
  kind            text not null,
  detail          text not null,
  actor_user_id   uuid references user_profiles (id) on delete set null,
  actor_name      text,
  created_at      timestamptz not null default now()
);

create index onboarding_activity_group_idx
  on onboarding_activity (client_group_id, created_at desc);

alter table onboarding_step_template enable row level security;
alter table onboarding_step_state    enable row level security;
alter table onboarding_activity      enable row level security;

create policy admin_all on onboarding_step_template for all using (auth_is_admin()) with check (auth_is_admin());
create policy read_all  on onboarding_step_template for select using (true);
create policy admin_all on onboarding_step_state    for all using (auth_is_admin()) with check (auth_is_admin());
create policy admin_all on onboarding_activity      for all using (auth_is_admin()) with check (auth_is_admin());

-- Precedence, highest first: every step done beats a manual hold, because once
-- the work is finished "waiting on somebody" is no longer true; a hold beats the
-- forms, but only while it is newer than the newest form.
create or replace function onboarding_status_for(p_group uuid)
returns onboarding_status
language plpgsql stable set search_path = public, pg_temp
as $fn$
declare
  v_active integer; v_done integer;
  v_latest_form timestamptz; v_manual_at timestamptz;
  v_manual onboarding_status; v_form_stage onboarding_status;
begin
  select count(*) into v_active from onboarding_step_template where is_active;

  select count(*) into v_done
  from onboarding_step_state s
  join onboarding_step_template t on t.step_key = s.step_key and t.is_active
  where s.client_group_id = p_group and s.done_at is not null;

  if v_active > 0 and v_done >= v_active then return 'launch_ready'; end if;

  select max(submitted_at) into v_latest_form
  from form_submissions
  where client_group_id = p_group and not is_test
    and form_key in ('new-client','client-onboarding','client-onboarding-legacy','kick-off');

  select onboarding_status, status_set_manually_at into v_manual, v_manual_at
  from client_groups where id = p_group;

  if v_manual in ('waiting_on_team','waiting_on_client')
     and v_manual_at is not null
     and (v_latest_form is null or v_manual_at > v_latest_form) then
    return v_manual;
  end if;

  select case
           when bool_or(form_key = 'kick-off') then 'kickoff_form'
           when bool_or(form_key in ('client-onboarding','client-onboarding-legacy')) then 'onboarding_form'
           else 'new_signup'
         end::onboarding_status
    into v_form_stage
  from form_submissions where client_group_id = p_group and not is_test;

  return coalesce(v_form_stage, 'new_signup');
end;
$fn$;

create or replace function refresh_onboarding_status(p_group uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare v_now onboarding_status; v_next onboarding_status;
begin
  if p_group is null then return; end if;
  select onboarding_status into v_now from client_groups where id = p_group;
  v_next := onboarding_status_for(p_group);
  if v_next is distinct from v_now then
    update client_groups set onboarding_status = v_next where id = p_group;
    insert into onboarding_activity (client_group_id, kind, detail, actor_name)
    values (p_group, 'status_changed',
            format('Moved from %s to %s', v_now, v_next), 'Automatic');
  end if;
end;
$fn$;

create or replace function tg_refresh_onboarding_status()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $fn$
begin
  perform refresh_onboarding_status(coalesce(new.client_group_id, old.client_group_id));
  return null;
end;
$fn$;

create trigger form_submissions_refresh_onboarding
  after insert or update or delete on form_submissions
  for each row execute function tg_refresh_onboarding_status();

create trigger onboarding_step_state_refresh_status
  after insert or update or delete on onboarding_step_state
  for each row execute function tg_refresh_onboarding_status();

insert into onboarding_step_template
  (step_key, group_key, group_label, label, automated, sort_order) values
  ('ghl_subaccount', 'ghl', 'GHL Set Up', 'Create sub account', true, 10),
  ('ghl_custom_values', 'ghl', 'GHL Set Up', 'Fill custom values', true, 20),
  ('ghl_subdomain', 'ghl', 'GHL Set Up', 'Create and connect subdomain', true, 30),
  ('ghl_phone', 'ghl', 'GHL Set Up', 'Purchase and configure phone number', false, 40),
  ('ghl_a2p', 'ghl', 'GHL Set Up', 'Submit A2P', false, 50),
  ('ghl_automation', 'ghl', 'GHL Set Up', 'Configure the automation', false, 60),
  ('hp_integrate', 'hp', 'HotProspector Set Up', 'Integrate sub account', false, 110),
  ('hp_phone', 'hp', 'HotProspector Set Up', 'Buy phone number', false, 120),
  ('hp_scripts', 'hp', 'HotProspector Set Up', 'Script templates configuration', false, 130),
  ('hp_business_reg', 'hp', 'HotProspector Set Up', 'Submit business registration', false, 140),
  ('hp_custom_values', 'hp', 'HotProspector Set Up', 'Custom values', false, 150),
  ('hp_webhook', 'hp', 'HotProspector Set Up', 'Global webhook integration', false, 160),
  ('ads_pixel_config', 'ads', 'Ads Set Up', 'Data and pixel configuration', false, 210),
  ('ads_buildout', 'ads', 'Ads Set Up', 'Facebook ads buildout', false, 220),
  ('ads_pixel_code', 'ads', 'Ads Set Up', 'Add pixel code', false, 230),
  ('ads_copy', 'ads', 'Ads Set Up', 'Ads copy creation', false, 240);


-- ===========================================================================
-- PROVISIONING
--
-- Every attempt to build a sub-account from the onboarding form, successful or
-- not, so provisioning can fail without losing anything. The submission is
-- saved first and this records what happened next: a refused API call becomes a
-- retry rather than a practice filling the form twice.
--
-- Append-only per attempt. The second try does not overwrite the first, because
-- "it worked on the third go" and "it worked" are different facts and only one
-- of them should send somebody to fix the cause.
--
-- crm_location_id is what makes a retry safe. With an id, the retry configures
-- the account that already exists; without it, an agency ends up with two
-- sub-accounts for one practice and nobody notices for a month.
-- ===========================================================================

create table provisioning_runs (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid references form_submissions (id) on delete set null,
  client_group_id   uuid references client_groups (id) on delete set null,
  clinic_name       text not null,
  snapshot_id       text not null,
  -- 'created' | 'values_written' | 'partial' | 'failed'
  status            text not null,
  crm_location_id   text,
  values_written    text[] not null default '{}',
  values_missing    text[] not null default '{}',
  values_failed     jsonb  not null default '[]'::jsonb,
  error             text,
  -- True when the refusal looked like authorisation rather than data, which is
  -- the difference between "re-authorise the app" and "fix the form".
  scope_problem     boolean not null default false,
  started_by        uuid references user_profiles (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index provisioning_runs_submission_idx on provisioning_runs (submission_id);
create index provisioning_runs_group_idx on provisioning_runs (client_group_id);
create index provisioning_runs_created_idx on provisioning_runs (created_at desc);

alter table provisioning_runs enable row level security;
create policy admin_all on provisioning_runs
  for all using (auth_is_admin()) with check (auth_is_admin());

-- Which credential the attempt went out under. Without it, "401 from
-- /locations/" cannot be told apart from "the private token is not accepted for
-- this endpoint", and those two have opposite fixes.
alter table provisioning_runs add column auth_kind text;

-- Joshua's B2B pipeline has a Nurture stage — a lead parked deliberately, which
-- is neither lost nor in progress. Without it the sync mapped Nurture to 'new'
-- and reported held leads as fresh ones.
alter type deal_stage add value if not exists 'nurture';
