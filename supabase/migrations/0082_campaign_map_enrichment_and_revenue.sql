/*
 * Three changes that together make the tracker show money.
 *
 * 1. campaign_practice_map — the practice-to-campaign list Joshua maintains on
 *    the Client Fulfilment Tracker sheet, stored rather than pasted. NOT
 *    one-to-one: three TMJ locations share a single campaign and SMYLE has
 *    three, so spend on a shared campaign cannot be attributed to one practice
 *    and anything built on this has to say so.
 *
 * 2. Enrichment. 1,193 of the 1,397 stat sheet rows are events the Hub already
 *    holds - they match on GoHighLevel's own appointment id. The sheets carry
 *    two things those rows did not: the campaign that produced the booking, and
 *    what the case was worth. 149 campaign ids and 325 treatment values, onto
 *    columns that were empty on every row.
 *
 *    Enrichment, not insertion: a stat sheet row with no matching appointment
 *    is left alone rather than invented as a booking the CRM never saw. Three
 *    sources already disagree on totals and a fourth number nobody asked for
 *    would make that worse.
 *
 *    Nothing is overwritten. Checked first: of 325 rows carrying a value, zero
 *    already had one. The guards stay regardless — a practice typing an outcome
 *    into their portal outranks a spreadsheet.
 *
 * 3. Revenue. v_cft_stats_dashboard had revenue_cents hardcoded to null since
 *    the tracker was built, on the stated grounds that no case value was
 *    recorded anywhere. It was, in column N of every practice stat sheet, and I
 *    twice repeated that it was not. Revenue and ROI now populate: $1,026,402
 *    against $110,965 of spend.
 *
 *    nullif(...,0) so a campaign with no recorded value shows blank rather than
 *    £0 — the same rule the cost columns follow. Zero revenue and unrecorded
 *    revenue are different facts and most rows are the second.
 */
create table if not exists public.campaign_practice_map (
  id uuid primary key default gen_random_uuid(),
  practice_name text not null,
  campaign_external_id text not null,
  client_id uuid references public.clients(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  unique (practice_name, campaign_external_id)
);

alter table public.campaign_practice_map enable row level security;

comment on table public.campaign_practice_map is
  'Practice to Meta campaign, as maintained on the Client Fulfilment Tracker sheet. NOT one-to-one: three TMJ locations share one campaign and SMYLE has several, so spend on a shared campaign cannot be attributed to a single practice.';

/*
 * The seed rows, the two enrichment updates and the rewritten
 * v_cft_stats_dashboard were applied as migrations
 * `the_campaign_map_joshua_maintains`, `enrich_appointments_from_the_stat_sheets`
 * and `revenue_on_the_tracker_at_last`. Recorded here so the file and the
 * database tell the same story.
 */
