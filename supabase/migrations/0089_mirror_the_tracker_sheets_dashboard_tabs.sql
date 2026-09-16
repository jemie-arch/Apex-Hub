/*
 * A copy of the tracker workbook's computed tabs, so the Hub can be checked
 * against the sheet in SQL rather than by eye.
 *
 * "What you got is not accurate" is only answerable with the sheet's own
 * figures beside the Hub's for the same practice, column and window. The
 * sheet's STATS DASHBOARD and Client Results tabs are formulas over the same
 * raw tabs the Hub imports, so they are the reference. Reading them into a
 * table once per run makes the comparison a query, and keeps it repeatable
 * after every fix.
 *
 * Raw cells as the sheet formats them, one row per sheet row, no
 * interpretation here. The tracker-dashboard-mirror sync fills it and notes
 * the header rows it saw so the columns can be named in the query.
 */
create table if not exists public.cft_sheet_mirror (
  id uuid primary key default gen_random_uuid(),
  tab text not null,
  row_number integer not null,
  cells text[] not null,
  imported_at timestamptz not null default now(),
  unique (tab, row_number)
);

alter table public.cft_sheet_mirror enable row level security;

comment on table public.cft_sheet_mirror is
  'Raw cells of the Client Fulfilment Tracker workbook''s computed tabs (STATS DASHBOARD, Client Results), one row per sheet row, as the spreadsheet formats them. Exists so the Hub''s figures can be diffed against the sheet''s in SQL. Service role only; contains no patient detail beyond what the dashboard tabs already show.';
