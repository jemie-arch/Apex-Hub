-- Record the callback and confirmation alerts, so the five minutes is measurable.
--
-- Two Make scenarios fire whenever a lead asks to be called back or an
-- appointment needs confirming:
--
--   296215  "Call back request"        -> Slack, "CALL WITHIN 5 MINUTES"
--   296197  "Appointment Confirmation" -> Slack
--
-- Both do exactly one thing: post a message to the private channel
-- watch-shift-alert. Nothing else. No row is written anywhere, by anything.
--
-- So the promise in that message is unmeasurable. Nobody can say how many
-- callbacks came in yesterday, how many were answered inside five minutes, or
-- which were never answered at all — the only record is a Slack message
-- somebody was asked to put a tick on.
--
-- This table is the record. The scenarios keep posting to Slack exactly as they
-- do now; one additional HTTP module also posts here.
--
-- WHY THE ANSWER IS NOT STORED
--
-- Because it can be derived, and a derived answer cannot go stale. The `calls`
-- table already holds every call with its start time and the contact's phone
-- number, so "was this answered, and how fast" is a query rather than a field
-- somebody has to remember to update. A stored flag would need its own
-- automation and would be wrong the first time one failed.

create table callcentre_requests (
  id            uuid primary key default gen_random_uuid(),

  /*
   * Which alert fired. Both scenarios post an almost identical payload, so the
   * kind has to come from the scenario rather than be inferred from the body —
   * and 296197's message text still reads "requested a call back", copied from
   * 296215, which is exactly why inferring would be wrong.
   */
  kind          text not null check (kind in ('callback', 'confirmation')),

  requested_at  timestamptz not null default now(),
  requested_on  date not null default (now() at time zone 'utc')::date,

  crm_contact_id text,
  lead_name      text,
  lead_phone     text,

  /* The sub-account, as GoHighLevel names it, plus the Hub's own client. */
  location_crm_id text,
  location_name   text,
  client_id       uuid references clients (id) on delete set null,

  /* When the lead asked to be called, where the alert carries it. */
  callback_due_at timestamptz,

  sop_link      text,

  /*
   * The alert as received, minus nothing.
   *
   * Kept because these payloads have never been stored before, so nobody knows
   * which of GoHighLevel's forty-odd fields are reliably populated. The first
   * week of real alerts answers that, and without the body there is nothing to
   * answer it from. It carries a patient's name and number, which the columns
   * above already do — so this adds no exposure the row did not already have.
   */
  payload       jsonb,

  /* Make's own execution id, so a duplicate delivery updates rather than doubles. */
  delivery_id   text unique,

  received_at   timestamptz not null default now()
);

create index callcentre_requests_day_idx on callcentre_requests (requested_on desc, kind);
create index callcentre_requests_phone_idx on callcentre_requests (lead_phone)
  where lead_phone is not null;
create index callcentre_requests_contact_idx on callcentre_requests (crm_contact_id)
  where crm_contact_id is not null;

alter table callcentre_requests enable row level security;

-- Staff only. A callback request is a patient asking to be phoned; it is not
-- something a client portal needs and the portal is token-authenticated.
create policy callcentre_requests_staff_read on callcentre_requests
  for select
  using (auth_role() is not null and auth_role() <> 'client');

comment on table callcentre_requests is
  'Callback requests and appointment confirmations, as received from Make '
  'scenarios 296215 and 296197. Those scenarios post to Slack and record '
  'nothing, so the "call within 5 minutes" promise has never been measurable. '
  'Whether a request was answered is deliberately NOT stored — it is derived '
  'from the calls table by v_callcentre_response, because a derived answer '
  'cannot go stale and a stored flag needs its own automation to stay true.';

/*
 * Was it answered, and how fast?
 *
 * Matched on the last ten digits of the phone number, because a request
 * carries whatever GoHighLevel holds — +1 (555) 010-0000 — and a call carries
 * whatever the dialler recorded. Comparing them as typed matches almost
 * nothing; comparing the last ten matches a North American number however
 * either side punctuated it.
 *
 * Ten and not the whole string, on purpose: a leading 1 is present on one side
 * and absent on the other about as often as not.
 */
create view v_callcentre_response
with (security_invoker = on) as
  with digits as (
    select
      r.*,
      right(regexp_replace(coalesce(r.lead_phone, ''), '[^0-9]', '', 'g'), 10) as phone10
    from callcentre_requests r
  ),
  answered as (
    select
      d.id,
      min(c.started_at) filter (where c.started_at >= d.requested_at) as first_call_at
    from digits d
    left join calls c
      on length(d.phone10) = 10
     and right(regexp_replace(coalesce(c.contact_phone, ''), '[^0-9]', '', 'g'), 10) = d.phone10
     -- Bounded to a day. A call three weeks later is not a response to this
     -- request, and counting it would report an SLA nobody met.
     and c.started_at between d.requested_at and d.requested_at + interval '24 hours'
    group by d.id
  )
  select
    d.id,
    d.kind,
    d.requested_at,
    d.requested_on,
    d.lead_name,
    d.location_name,
    d.client_id,
    a.first_call_at,
    case
      when a.first_call_at is null then null
      else round(extract(epoch from (a.first_call_at - d.requested_at)) / 60.0, 1)
    end as minutes_to_first_call,
    a.first_call_at is not null as answered,
    /*
     * The promise the Slack message makes, and the only reason this view
     * exists. Null rather than false when unanswered, so "missed the five
     * minutes" and "never called at all" stay different facts.
     */
    case
      when a.first_call_at is null then null
      else a.first_call_at <= d.requested_at + interval '5 minutes'
    end as within_five_minutes
  from digits d
  left join answered a on a.id = d.id;

comment on view v_callcentre_response is
  'Each callback request or confirmation alert with the first call to that '
  'number afterwards, and how many minutes later it came. Matched on the last '
  'ten digits of the phone number, because the request and the call punctuate '
  'it differently, and bounded to 24 hours — a call three weeks later is not a '
  'response. within_five_minutes is null when nobody called at all, so missing '
  'the promise and ignoring it entirely are not counted as the same thing.';
