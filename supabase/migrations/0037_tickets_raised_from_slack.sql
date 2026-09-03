-- Tech support tickets, raised by tagging @apex in Slack.
--
-- WHY NOT tech_calls
--
-- The Tech Support page already has a table, and reusing it was the obvious
-- move. It is the wrong shape. tech_calls models a booking: it has a preferred
-- time, a confirm step that exists because confirming is when a clinic is told
-- to be somewhere, and it closes as completed, cancelled or no_show. A ticket
-- typed into Slack has no time, nobody to tell, and closes as resolved. Forcing
-- one into the other would have meant a no-show ticket -- a status that cannot
-- happen and would sit in the enum inviting somebody to set it.
--
-- So: a second table on the same page. The page answers one question in two
-- halves -- what has been asked of tech, and what has been booked with tech.
--
-- WHY THE SLACK COLUMNS ARE NOT DECORATION
--
-- slack_channel_id + slack_message_ts carry a unique index, and that index is
-- the whole idempotency story. Slack retries an event delivery up to three
-- times when the endpoint does not answer within three seconds, with no way to
-- turn that off, and a retry is byte-identical to the original. Without the
-- index a slow cold start would silently file the same ticket three times and
-- ping Ally three times for it. With it, the second insert conflicts and the
-- route answers the retry with the ticket the first attempt already created.
--
-- This is the same rule the syncs hold -- re-running never duplicates, because
-- every one of them upserts on an external id. A Slack message ts is an
-- external id like any other.
--
-- WHY raised_by AND raised_by_name BOTH EXIST
--
-- raised_by is the Hub user, matched from the Slack account's email. It is null
-- whenever the person tagging @apex has no Hub login, which is most of the
-- workspace and always will be. raised_by_name is their Slack display name and
-- is never null, so a ticket always says who asked even when the Hub has never
-- heard of them. Storing only the foreign key would have thrown that away.

-- ---------------------------------------------------------------------------
-- open -> in_progress -> resolved, plus closed for a ticket that needed nothing
-- doing. No 'cancelled': a ticket raised in error is closed, and the difference
-- between the two words is not worth a status somebody has to choose between.
create type tech_ticket_status as enum (
  'open',
  'in_progress',
  'resolved',
  'closed'
);

-- Set from an explicit #urgent / #high / #low tag in the Slack message, never
-- inferred from its wording. Guessing urgency from the presence of the word
-- "asap" would be wrong often enough to make the field untrustworthy, and an
-- untrustworthy priority is worse than none.
create type tech_ticket_priority as enum ('low', 'normal', 'high', 'urgent');

create table tech_tickets (
  id                 uuid primary key default gen_random_uuid(),

  -- Which practice this is about, when somebody says so. Deliberately never
  -- inferred by matching practice names against the message text: the
  -- reconciliation page exists because that kind of matching is unreliable,
  -- and a ticket filed against the wrong client is worse than one filed
  -- against none.
  client_group_id    uuid references client_groups (id) on delete set null,

  title              text not null,
  body               text,

  status             tech_ticket_status not null default 'open',
  priority           tech_ticket_priority not null default 'normal',

  -- Who owns it. Defaulted to Ally by the Slack route, changeable on the page.
  assigned_to        uuid references user_profiles (id) on delete set null,

  -- Who asked. See the note above on why this is two columns.
  raised_by          uuid references user_profiles (id) on delete set null,
  raised_by_name     text,

  -- 'slack' for anything the bot filed, 'hub' for a ticket typed in by hand.
  source             text not null default 'slack',

  slack_team_id      text,
  slack_channel_id   text,
  slack_channel_name text,
  slack_message_ts   text,
  -- The thread the bot replies into: the parent when the mention was itself a
  -- reply, otherwise the mention's own ts.
  slack_thread_ts    text,
  slack_permalink    text,

  resolved_at        timestamptz,
  resolved_by        uuid references user_profiles (id) on delete set null,
  resolution         text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table tech_tickets is
  'Tech support tickets. Filed by tagging @apex in Slack (source = slack) or typed into the Hub by hand (source = hub). Distinct from tech_calls, which models a scheduled clinic call rather than a piece of work.';

comment on column tech_tickets.slack_message_ts is
  'The ts of the message that tagged @apex. Unique with slack_channel_id, which is what makes a Slack event retry file nothing the second time.';

comment on column tech_tickets.raised_by_name is
  'The Slack display name of whoever tagged @apex. Kept even when raised_by is null, which is the normal case for anybody without a Hub login.';

-- Idempotency. Partial, so hand-typed tickets -- which have no ts -- are not
-- forced to collide on a null.
create unique index tech_tickets_slack_message_idx
  on tech_tickets (slack_channel_id, slack_message_ts)
  where slack_message_ts is not null;

create index tech_tickets_status_idx on tech_tickets (status, created_at desc);
create index tech_tickets_assigned_idx on tech_tickets (assigned_to)
  where assigned_to is not null;
create index tech_tickets_group_idx on tech_tickets (client_group_id)
  where client_group_id is not null;

create trigger tech_tickets_set_updated_at
  before update on tech_tickets
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS, matching tech_calls. The page reads through the service role; these
-- policies cover a signed-in browser client.
alter table tech_tickets enable row level security;

create policy admin_all on tech_tickets
  for all using (auth_is_admin()) with check (auth_is_admin());

-- Ally is role 'tech', not an admin, so without this she cannot read the
-- tickets assigned to her from a browser client. Read only: moving a ticket
-- through its statuses goes through a server action, which checks separately.
create policy assignee_read on tech_tickets
  for select using (assigned_to = auth.uid() or raised_by = auth.uid());
