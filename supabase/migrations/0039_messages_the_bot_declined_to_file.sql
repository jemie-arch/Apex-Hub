-- Mentions the bot decided were not requests.
--
-- The classifier in lib/slack/classify declines messages that tag @apex without
-- asking for anything -- announcements about the bot, testing, thanks. Its
-- verdict is a judgement, and judgements are wrong sometimes.
--
-- This table is what makes being wrong cheap. A declined message is kept here
-- with everything needed to file it, so reacting :ticket: on the original
-- message promotes it to a real ticket with no retyping and no lost detail. The
-- alternative -- discarding it and asking the person to write the whole thing
-- out again -- would make a wrong decline expensive enough that people stop
-- trusting the bot, which costs more than the noise the classifier was added to
-- remove.
--
-- WHY NOT A STATUS ON tech_tickets
--
-- Because a declined message is not a ticket. Putting it in tech_tickets as
-- 'declined' would mean every count, every KPI card and every "open tickets"
-- query grows a `where status <> 'declined'` clause, and the first one somebody
-- forgets silently inflates the number the tech team is measured by. Separate
-- table, no filtering to forget.
--
-- These rows are evidence as well as recovery. A run of declines that all got
-- promoted by hand is the signal that the prompt in classify.ts needs work --
-- so promoted rows are kept and marked, never deleted.

create table tech_ticket_candidates (
  id                 uuid primary key default gen_random_uuid(),

  slack_team_id      text,
  slack_channel_id   text not null,
  slack_channel_name text,
  slack_message_ts   text not null,
  slack_thread_ts    text,
  slack_permalink    text,

  -- Exactly what the ticket would have said, decided at decline time so that
  -- promotion is a copy rather than a re-parse. Re-parsing later would apply
  -- whatever the parser does *then* to a message written now.
  title              text not null,
  body               text,
  priority           tech_ticket_priority not null default 'normal',
  assigned_to        uuid references user_profiles (id) on delete set null,
  also_notify        uuid[] not null default '{}',

  raiser_slack_id    text,
  raiser_name        text,
  raised_by          uuid references user_profiles (id) on delete set null,

  /** The classifier's own words, shown in the thread and kept for review. */
  declined_reason    text,

  -- Set when somebody reacts :ticket: and the message becomes a real ticket.
  promoted_ticket_id uuid references tech_tickets (id) on delete set null,
  promoted_at        timestamptz,

  created_at         timestamptz not null default now()
);

comment on table tech_ticket_candidates is
  'Mentions the classifier decided were not requests. Kept so a :ticket: reaction can promote one to a real ticket, and so a pattern of wrong declines is visible rather than invisible.';

-- Same idempotency story as tech_tickets: Slack retries an event delivery up to
-- three times with a byte-identical payload, and without this a slow classifier
-- would post the same "I did not file this" reply three times.
create unique index tech_ticket_candidates_message_idx
  on tech_ticket_candidates (slack_channel_id, slack_message_ts);

-- The lookup the reaction handler does: this channel, this message.
create index tech_ticket_candidates_pending_idx
  on tech_ticket_candidates (created_at desc)
  where promoted_ticket_id is null;

alter table tech_ticket_candidates enable row level security;

create policy admin_all on tech_ticket_candidates
  for all using (auth_is_admin()) with check (auth_is_admin());
