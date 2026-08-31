-- Close a hole: a write to a file nobody owns was invisible.
--
-- misdirected_write inner-joins the module's spreadsheet id against `owners`,
-- the set of files that are some scenario's primary target. That catches a
-- module writing into ANOTHER PRACTICE'S file. It silently drops a module
-- writing into a file that is nobody's primary — no owners row, no join, no
-- finding.
--
-- Art of Smile is the case that exposed it. Its booking scenario has thirteen
-- sheet operations against a fleet standard of eight: eight to its own file and
-- five to an id that appears in no other scenario anywhere. Five operations
-- writing somewhere unaudited, and the findings view said the scenario was
-- clean.
--
-- That is the worse half of the fault class, not the lesser one. A write into a
-- known practice's sheet at least lands where somebody is looking. A write into
-- an unowned file lands where nobody is.
--
-- Severity 1. It also matters for the cutover specifically: the consolidated
-- scenario routes one clinic to one sheet, so any practice with a second
-- destination loses those writes the moment it switches over, and somebody has
-- to decide what that file is first.
--
-- The full view is restated because a clause cannot be added to a view in
-- place. Only the writes_to_unowned_sheet branch and the comment are new;
-- everything else is 0013 verbatim.
create or replace view scenario_sheet_findings as
with primary_sheet as (
  select scenario_id, primary_sheet_id from scenario_primary_sheet
),
owners as (
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

-- A write module pointing at a file that is nobody's primary target.
select
  t.scenario_id,
  t.scenario_name,
  t.folder,
  t.is_active,
  t.last_edited_at,
  t.last_edited_by,
  'writes_to_unowned_sheet',
  1,
  string_agg(distinct t.module_id::text, ', ' order by t.module_id::text),
  t.spreadsheet_id,
  null,
  format(
    'Module(s) %s write to a file that is not this practice''s sheet and is not '
    || 'the primary sheet of any audited scenario, so nothing else in the fleet '
    || 'reads it. Either this practice keeps a second sheet on purpose, or these '
    || 'writes go where nobody is looking. It also has to be settled before this '
    || 'clinic can move to the consolidated scenario, which writes to one file.',
    string_agg(distinct t.module_id::text, ', ' order by t.module_id::text)
  )
from scenario_sheet_targets t
join primary_sheet p on p.scenario_id = t.scenario_id
where t.spreadsheet_id is not null
  and t.spreadsheet_id <> p.primary_sheet_id
  and t.operation <> 'filterRows'
  and not exists (
    select 1 from owners o where o.sheet_id = t.spreadsheet_id
  )
group by t.scenario_id, t.scenario_name, t.folder, t.is_active,
         t.last_edited_at, t.last_edited_by, t.spreadsheet_id

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
  'Configuration faults in the Make scenarios, derived from ids rather than labels. Severity 1 is a wrong, unowned or ambiguous target; 2 is a formatting fault. writes_to_unowned_sheet exists because the misdirected_write clause joins against known sheet owners and so could only ever see a write that landed in another practice''s file — a write into a file nobody owns produced no row at all, which is the worse case of the two. Says nothing about whether a fault has executed: Make''s execution list cannot support that claim, so whether rows actually moved must be checked in the target sheet.';
