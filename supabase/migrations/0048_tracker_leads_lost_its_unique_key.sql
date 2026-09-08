-- tracker_leads lost the unique key its import depends on.
--
-- The first ever run of fulfilment-leads read 1,115 rows from the sheet and
-- wrote none of them:
--
--   Could not write lead rows 2-201: there is no unique or exclusion
--   constraint matching the ON CONFLICT specification
--
-- The sync upserts on source_row, which migration 0001 declares as
-- `source_row integer not null unique`. That constraint is not in the live
-- database. It was lost when the schema was rebuilt in
-- rebuild_with_client_groups_and_call_centre_roles on 21 August 2026 — the
-- table came back with a primary key on id and a foreign key on client_id, and
-- nothing else.
--
-- Nothing noticed for eighteen days because nothing wrote to this table. The
-- 1,103 rows in it were loaded by hand on 22 August, and the sync that would
-- have hit this constraint was only written yesterday. A missing unique key is
-- invisible until somebody depends on it.
--
-- Safe to add: 1,103 rows, 1,103 distinct source_rows, none null.

alter table tracker_leads
  add constraint tracker_leads_source_row_key unique (source_row);

comment on constraint tracker_leads_source_row_key on tracker_leads is
  'The sheet''s own row number, and the key fulfilment-leads upserts on. '
  'Declared in 0001, lost in the 21 August rebuild, restored here after the '
  'first run of the import failed on its absence. Without it the sync cannot '
  'write at all, so tracker_leads stays frozen and leads_best falls back to '
  'Windsor — which reports nothing for most accounts.';

/*
 * The same absence, checked everywhere else it would do the same damage.
 *
 * Every sync in the Hub upserts on a natural key it assumes is unique, and
 * this one was wrong in the live database while being right in 0001. So the
 * others are asserted rather than trusted: a missing key here is silent until
 * a first run, and three of these tables have never had one.
 */
do $$
declare
  missing text;
begin
  select string_agg(needed.table_name || '(' || needed.column_name || ')', ', ')
    into missing
  from (values
    ('tracker_leads',           'source_row'),
    ('tracker_appointments',    'source_row'),
    ('booking_sheet_rows',      'source_row'),
    ('invalid_booking_reports', 'source_row')
  ) as needed(table_name, column_name)
  where not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname::text = needed.table_name
      and c.contype in ('u', 'p')
      and (
        -- attname is type name, not text; array_agg of it will not
        -- compare to a text[] literal without the cast.
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(c.conkey) as k(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array[needed.column_name]
  );

  if missing is not null then
    raise exception
      'These tables are upserted on a column with no unique constraint, so '
      'their sync cannot write: %. Add the constraint before the sync runs, '
      'not after it fails.', missing;
  end if;
end
$$;
