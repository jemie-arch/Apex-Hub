-- The RAW DATA tab, which is what the pay dashboard actually counts.
--
-- WHY THIS EXISTS
--
-- Agent pay could not be reconciled: the Hub said 59 and 68 bookings for two
-- agents where the dashboard said 63 and 54 — disagreeing in OPPOSITE
-- directions, which ruled out the date window and every other single-cause
-- explanation. Reading the dashboard's own formula settled it. Cell J2:
--
--   =if(A2 = "","",IF($A$7 = "Today", 'TODAY''S DATA'!C3, IFS(
--     $A$7 = "Yesterday", COUNTIFS('RAW DATA'!C:C, A2,
--                                  'RAW DATA'!N:N, "*Booked*", ...
--
-- Five IFS branches on the A7 period selector — Today, Yesterday, Last 3 Days,
-- Last 7 Days, Last 30 Days — each a COUNTIFS over 'RAW DATA' with day offsets
-- of TODAY()-1, -2, -6 and -29.
--
-- So the dashboard counts the RAW DATA tab and the Hub counts the BOOKING SHEET
-- tab. Neither was wrong; they were answering different questions about
-- different sheets. Nothing reconciles until the Hub reads the same tab, which
-- is what this table is for.
--
-- Cross-referenced against Make scenario 5560467 module #5, which writes this
-- tab by position with useColumnHeaders false, the columns the formula uses are:
--
--   column A  call_time          the date COUNTIFS bounds
--   column C  agent_name         matched against the agent
--   column N  call_dispostion    matched against "*Booked*"
--
-- "call_dispostion" is the scenario's own misspelling. It is reproduced here in
-- the header aliases because matching the sheet matters more than spelling.
--
-- PHI DELIBERATELY NOT IMPORTED
--
-- Module #5 writes 22 values and four of them are patient identifiers:
-- last_name (E), email (F), first_name (I) and mobile (M). None is needed to
-- count a booking or measure an agent, so none is stored. lead_crm_id is kept
-- instead, which reaches the contact in GoHighLevel for anyone who has the
-- right to look. Importing a patient's name into a table that exists to
-- calculate commission would be collecting it for no reason.
--
-- Column G is call_time a second time — the scenario writes it twice — and is
-- therefore not mapped.

create table raw_call_rows (
  id                uuid primary key default gen_random_uuid(),

  /*
   * The sheet row number, and the upsert key.
   *
   * Same approach as call_summaries: the tab is append-only in practice, so a
   * row number is stable, and re-importing must update a row rather than
   * duplicate it. A row that is ever deleted from the sheet would leave a stale
   * row here, which is the accepted trade — the alternative is deleting Hub
   * rows on the strength of an absence, and absence is not evidence.
   */
  source_row        integer not null unique,

  called_at         timestamptz,
  /* Date in the sheet's own terms, which is what the COUNTIFS bounds. */
  called_on         date,

  agent_name        text,
  /* Resolved against the roster, never taken from the sheet. */
  agent_id          uuid references call_agents (id) on delete set null,

  /*
   * The disposition, verbatim. The dashboard matches "*Booked*" as a wildcard,
   * so this is stored as written and matched with a pattern rather than being
   * normalised into a boolean on import — a normalisation would bake today's
   * spellings into history, and this column is written by whatever HotProspector
   * sends.
   */
  disposition       text,

  duration_seconds  integer,
  direction         text,
  status            text,

  lead_source       text,
  location_name     text,
  /* Resolved from location_name, so a booking can be scoped to a practice. */
  client_id         uuid references clients (id) on delete set null,

  lead_crm_id       text,
  member_crm_id     text,
  group_crm_id      text,

  from_number       text,
  to_number         text,
  country_code      text,
  time_zone         text,

  stage_entry_date  date,
  lead_created_date date,

  imported_at       timestamptz not null default now()
);

comment on table raw_call_rows is
  'The RAW DATA tab of the call centre workbook, written by Make scenario '
  '5560467 module #5. This is the tab the pay dashboard''s J2 counts, so it is '
  'the only source that reconciles with what agents are actually paid. Patient '
  'name, email and mobile are deliberately not imported: they are not needed to '
  'count a booking, and lead_crm_id reaches the contact for anyone entitled to '
  'look.';

comment on column raw_call_rows.disposition is
  'Column N of the sheet, whose header the scenario spells "call_dispostion". '
  'Stored verbatim; the booked test is a pattern match, mirroring the '
  'dashboard''s COUNTIFS criterion "*Booked*".';

comment on column raw_call_rows.source_row is
  'The sheet row number. Upsert key, so a re-import updates rather than '
  'duplicates.';

create index raw_call_rows_day_idx    on raw_call_rows (called_on desc);
create index raw_call_rows_agent_idx  on raw_call_rows (agent_id, called_on desc);
create index raw_call_rows_client_idx on raw_call_rows (client_id, called_on desc);
create index raw_call_rows_booked_idx on raw_call_rows (called_on desc)
  where disposition ilike '%booked%';

alter table raw_call_rows enable row level security;

/*
 * Staff only, no client access.
 *
 * Lighter than call_summaries — there is no transcript here — but it is still a
 * log of who called whom and when, and it drives what people are paid. A
 * practice has no business reading either.
 */
create policy raw_call_rows_staff_read on raw_call_rows
  for select
  using (auth_role() is not null and auth_role() <> 'client');

/*
 * The dashboard's J2, as a view.
 *
 * One row per agent per day with the booked count, so any window the dashboard
 * offers — today, yesterday, last 3, 7 or 30 days — is a date filter over this
 * rather than five separate formulas. The COUNTIFS criterion "*Booked*" becomes
 * ilike '%booked%': same wildcard, same case-insensitivity that Sheets applies.
 *
 * Counted from the roster id where one resolved, and reported by name too, so
 * an unrostered name is visible rather than silently dropped from pay.
 */
create view v_raw_booked_daily
with (security_invoker = on) as
  select
    r.agent_id,
    r.agent_name,
    r.called_on                                            as day,
    count(*)                                               as calls,
    count(*) filter (where r.disposition ilike '%booked%')  as booked,
    count(*) filter (where r.direction ilike '%out%')       as outbound,
    count(*) filter (where coalesce(r.duration_seconds, 0) >= 90) as convos_90s,
    sum(coalesce(r.duration_seconds, 0))                    as talk_seconds
  from raw_call_rows r
  where r.called_on is not null
  group by r.agent_id, r.agent_name, r.called_on;

comment on view v_raw_booked_daily is
  'Per agent per day from the RAW DATA tab. booked is the dashboard''s J2 '
  'criterion — disposition matching "*Booked*" — which is the count agent pay '
  'is calculated from. convos_90s uses the 90-second threshold the dashboard''s '
  'column H uses, not the two minutes call_summaries uses; they are different '
  'measures from different sheets and are deliberately not unified here.';
