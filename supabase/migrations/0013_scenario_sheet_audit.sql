-- ===========================================================================
-- Where each automation actually writes, and where that disagrees with itself.
--
-- The problem this exists to solve: in Make, every Google Sheets module stores
-- both the spreadsheet id it writes to and a cached label for display. The
-- label is written once, when somebody picks the file, and is never resolved
-- again. So a scenario can show the correct practice on every module and address
-- a different practice's file, and no amount of looking at the screen will
-- reveal it.
--
-- That is not hypothetical. Two scenarios were found addressing the identical
-- file while displaying different practice names, saved five minutes apart in
-- the same session — which is the proof the label is carried forward rather than
-- looked up. It survived an audit and a remediation pass because the interface
-- showed the right thing throughout.
--
-- The only way to see it is to compare ids across scenarios. That is a job for a
-- table, not a person, so this is the table.
-- ===========================================================================

create table if not exists scenario_sheet_targets (
  id                bigint generated always as identity primary key,
  scenario_id       bigint      not null,
  scenario_name     text        not null,
  folder            text,
  is_active         boolean     not null default true,
  last_edited_at    timestamptz,
  last_edited_by    text,
  module_id         integer     not null,
  operation         text        not null,
  -- Nullable: a module can legitimately have no file chosen yet. That is a
  -- finding in its own right, not a reason to reject the row.
  spreadsheet_id    text,
  -- Kept deliberately. The audit's whole subject is the distance between this
  -- and spreadsheet_id, so throwing away the stale value would throw away the
  -- evidence.
  label             text,
  id_was_padded     boolean     not null default false,
  observed_at       timestamptz not null default now(),
  unique (scenario_id, module_id)
);

comment on table scenario_sheet_targets is
  'One row per Google Sheets module per Make scenario: the spreadsheet id it actually writes to, alongside the display label Make shows for it. Both are stored because the audit is about the gap between them — the label is a cache frozen when the file was picked and is never re-resolved, so a scenario can display the right practice while addressing the wrong file.';

comment on column scenario_sheet_targets.label is
  'Stale by construction. Never treat this as the file name; it is what a human sees in Make, which is the thing that made these faults invisible.';

comment on column scenario_sheet_targets.id_was_padded is
  'The raw id carried leading or trailing whitespace. Recorded rather than silently trimmed: one scenario had a trailing newline on both lookup modules and nowhere else, 45 characters against 44, which is invisible in the interface and would break the lookup while every write module worked.';

create index if not exists scenario_sheet_targets_sheet_idx
  on scenario_sheet_targets (spreadsheet_id);
create index if not exists scenario_sheet_targets_scenario_idx
  on scenario_sheet_targets (scenario_id);

-- ---------------------------------------------------------------------------
-- Which file each scenario mainly writes to.
--
-- "Mainly" is the right word and the reason is practical. A misdirected scenario
-- is usually mostly correct — one or two modules of eight point somewhere else —
-- so the file used by the most modules is the one the scenario is understood to
-- own, and the minority are the suspects. Ties break on the id so the answer is
-- stable between runs rather than depending on row order.
-- ---------------------------------------------------------------------------
create or replace view scenario_primary_sheet as
select distinct on (scenario_id)
  scenario_id,
  scenario_name,
  folder,
  is_active,
  spreadsheet_id as primary_sheet_id,
  count(*)       as module_count,
  -- Carried through so the shared-sheet finding can say when the clash was last
  -- touched without joining back to the base table.
  max(last_edited_at) as last_edited_at
from scenario_sheet_targets
where spreadsheet_id is not null
group by scenario_id, scenario_name, folder, is_active, spreadsheet_id
order by scenario_id, count(*) desc, spreadsheet_id;

comment on view scenario_primary_sheet is
  'The spreadsheet each scenario writes to from the most modules — taken as the file it owns. Minority targets within the same scenario are what the findings view reports, because a misdirected scenario is typically correct on most of its modules and wrong on one or two.';

-- ---------------------------------------------------------------------------
-- The findings.
--
-- Four kinds, and the distinction between them is the difference between a
-- clerical fix and a data-integrity problem:
--
--   misdirected_write  a write module addresses a file some OTHER scenario owns.
--                      Named with the owner, because "wrong sheet" is not
--                      actionable and "writes into City Dental Centers" is.
--
--   read_write_split   the lookup module reads a file no write module in the
--                      same scenario touches. The consequence is specific and
--                      severe: the existing row is never found, so the
--                      not-exists branch always wins, every booking appends a
--                      duplicate, and the update module never fires once.
--
--   padded_id          whitespace in the id. Cheap to fix, silent when wrong.
--
--   shared_sheet       two scenarios each treat the same file as their own.
--                      One of them is wrong and this cannot say which — the
--                      labels disagree and are not evidence. It needs a look at
--                      the file in Drive, so it is reported as a question.
--
-- Deliberately NOT a finding: a scenario writing to several files where each has
-- its own lookup. That is a legitimate dual-write and one scenario does it on
-- purpose.
-- ---------------------------------------------------------------------------
create or replace view scenario_sheet_findings as
with primary_sheet as (
  select scenario_id, primary_sheet_id from scenario_primary_sheet
),
owners as (
  -- A file is "owned" by the scenarios whose primary target it is. More than one
  -- owner is itself the shared_sheet finding below.
  select primary_sheet_id as sheet_id,
         string_agg(distinct coalesce(folder, scenario_name), ' & '
                    order by coalesce(folder, scenario_name)) as owned_by,
         count(distinct scenario_id) as owner_count
  from scenario_primary_sheet
  group by primary_sheet_id
)
-- A write module pointing at another scenario's file.
select
  t.scenario_id,
  t.scenario_name,
  t.folder                                   as practice,
  t.is_active,
  t.last_edited_at,
  t.last_edited_by,
  'misdirected_write'                        as finding,
  1                                          as severity,
  t.module_id::text                          as modules,
  t.spreadsheet_id                           as sheet_id,
  o.owned_by                                 as belongs_to,
  format(
    'Module %s (%s) writes into the file owned by %s, while displaying %L.',
    t.module_id, t.operation, o.owned_by, coalesce(t.label, 'no label')
  )                                          as detail
from scenario_sheet_targets t
join primary_sheet p on p.scenario_id = t.scenario_id
join owners o        on o.sheet_id    = t.spreadsheet_id
where t.spreadsheet_id is not null
  and t.spreadsheet_id <> p.primary_sheet_id
  and t.operation <> 'filterRows'
  and o.owner_count = 1

union all

-- A lookup reading a file that nothing in the same scenario writes to.
select
  t.scenario_id,
  t.scenario_name,
  t.folder,
  t.is_active,
  t.last_edited_at,
  t.last_edited_by,
  'read_write_split',
  1,
  t.module_id::text,
  t.spreadsheet_id,
  null,
  format(
    'Module %s looks up rows in a file that no write module in this scenario '
    || 'targets, so the row is never found: every booking appends a duplicate '
    || 'and the update module never runs.',
    t.module_id
  )
from scenario_sheet_targets t
where t.operation = 'filterRows'
  and t.spreadsheet_id is not null
  and not exists (
    select 1 from scenario_sheet_targets w
    where w.scenario_id = t.scenario_id
      and w.operation <> 'filterRows'
      and w.spreadsheet_id = t.spreadsheet_id
  )

union all

-- Whitespace in the id.
select
  t.scenario_id,
  t.scenario_name,
  t.folder,
  t.is_active,
  t.last_edited_at,
  t.last_edited_by,
  'padded_id',
  2,
  t.module_id::text,
  t.spreadsheet_id,
  null,
  format(
    'Module %s (%s) has whitespace around its spreadsheet id, which Google may '
    || 'reject while every correctly-formed module in the same scenario keeps '
    || 'working.',
    t.module_id, t.operation
  )
from scenario_sheet_targets t
where t.id_was_padded

union all

-- One file, two scenarios each treating it as theirs.
select
  min(s.scenario_id),
  'multiple scenarios',
  o.owned_by,
  bool_or(s.is_active),
  max(s.last_edited_at),
  null,
  'shared_sheet',
  1,
  string_agg(distinct s.scenario_id::text, ', ' order by s.scenario_id::text),
  o.sheet_id,
  o.owned_by,
  format(
    '%s scenarios each write to this one file as if it were their own. The '
    || 'display labels disagree and are not evidence of ownership — this has to '
    || 'be settled by looking at the file in Drive.',
    o.owner_count
  )
from owners o
join scenario_primary_sheet s on s.primary_sheet_id = o.sheet_id
where o.owner_count > 1
group by o.sheet_id, o.owned_by, o.owner_count;

comment on view scenario_sheet_findings is
  'Configuration faults in the Make scenarios, derived from ids rather than labels. Severity 1 is a wrong or ambiguous target; 2 is a formatting fault. Says nothing about whether a fault has executed — Make''s execution list cannot support that claim, so whether rows actually moved must be checked in the target sheet.';

-- ---------------------------------------------------------------------------
-- Everyone can read; only admins write. Same shape as the rest of the schema.
-- The sync uses the service role and bypasses this.
-- ---------------------------------------------------------------------------
alter table scenario_sheet_targets enable row level security;

create policy scenario_sheet_targets_read on scenario_sheet_targets
  for select using (true);

create policy scenario_sheet_targets_admin on scenario_sheet_targets
  for all using (auth_is_admin()) with check (auth_is_admin());
