-- Watch for messages nobody answered, so the acknowledgement can be automatic.
--
-- One row per watched message. The sweeper reads this to decide what is still
-- unanswered, and it doubles as the audit trail of everything the bot said —
-- which matters more than usual here, because this is the one feature that
-- speaks in Slack without a person pressing anything.
--
-- WHAT IS DELIBERATELY NOT STORED: the message text.
--
-- The reply is an acknowledgement, not an answer, so nothing here needs to know
-- what was said — only that something was said, by whom, and whether it was
-- answered. Slack carries the conversation; this table carries the fact of it.
-- Storing previews would put core-team chatter, and anything a colleague
-- happened to paste into it, in a second place with a second set of ways to
-- leak. The cheapest way to protect text is not to hold it.

create table slack_watch_messages (
  id            uuid primary key default gen_random_uuid(),

  channel_id    text not null,
  -- Resolved once at capture. Slack renames channels and the name is only for
  -- a human reading this table later, so a stale one is better than a lookup
  -- per sweep against a rate-limited API.
  channel_name  text,

  -- The thread this belongs to, and the message itself. For a top-level
  -- message the two are equal, which is what Slack means by starting a thread.
  thread_ts     text not null,
  message_ts    text not null,

  author_slack_id text,
  author_name     text,

  detected_at   timestamptz not null default now(),

  /*
   * waiting  — inside the delay, or the sweeper has not reached it yet
   * answered — a human replied first, which is the outcome to hope for
   * replied  — the bot acknowledged it
   * skipped  — a guard stopped it; skip_reason says which
   */
  state         text not null default 'waiting'
                  check (state in ('waiting', 'answered', 'replied', 'skipped')),

  answered_at   timestamptz,
  replied_at    timestamptz,
  -- Exactly what was posted. The template can change; what went out cannot.
  reply_text    text,
  skip_reason   text,

  -- The guard that makes a reply loop impossible rather than unlikely: one row
  -- per message, so a duplicate Slack delivery updates instead of inserting,
  -- and one reply per thread is enforced by the partial index below.
  unique (channel_id, message_ts)
);

-- At most one bot reply per thread, ever, enforced by the database rather than
-- by the sweeper remembering. Two sweeps overlapping is the ordinary way a
-- watchdog turns into a spammer.
create unique index slack_watch_one_reply_per_thread
  on slack_watch_messages (channel_id, thread_ts)
  where state = 'replied';

-- The sweeper's only query: what is still waiting, oldest first.
create index slack_watch_waiting_idx
  on slack_watch_messages (detected_at)
  where state = 'waiting';

create index slack_watch_thread_idx
  on slack_watch_messages (channel_id, thread_ts);

alter table slack_watch_messages enable row level security;

/*
 * No policy, on purpose.
 *
 * RLS on with no policy means anon and authenticated see nothing at all, while
 * the service role bypasses it — and the service role is the only thing that
 * touches this table: the events route writing captures and the sweeper
 * posting replies. If a Hub screen ever needs to show this, it gets a policy
 * then, decided deliberately, rather than inheriting one written before there
 * was a reader.
 */

comment on table slack_watch_messages is
  'Messages seen in watched Slack channels and what the auto-acknowledgement '
  'did about them. Message text is deliberately not stored: the reply is an '
  'acknowledgement rather than an answer, so nothing here needs the content. '
  'Also the audit trail — this is the only feature that posts to Slack '
  'without a person pressing anything, so every send is recorded with the '
  'exact text that went out. state=answered means a human got there first, '
  'which is the point of the delay.';

-- Off until somebody turns it on, and the value carries the whole
-- configuration so it can be changed without a deploy.
insert into app_settings (key, value, description) values (
  'slack_autoreply',
  jsonb_build_object(
    'enabled', false,
    'delay_minutes', 2,
    'channel_ids', '[]'::jsonb,
    'author_slack_ids', '[]'::jsonb,
    'max_replies_per_hour', 6,
    'quiet_hours_start', 22,
    'quiet_hours_end', 7,
    'timezone', 'Asia/Manila',
    'template',
      'Seen this — Jemie has been notified and will come back to you shortly. '
      || 'This is an automatic acknowledgement, not an answer.'
  ),
  'Auto-acknowledgement of unanswered Slack messages. enabled is false until '
  'somebody sets channel_ids and turns it on. delay_minutes is how long a '
  'human gets to reply first. author_slack_ids empty means every human in '
  'those channels; listing ids narrows it. Replies post as the @apex bot — a '
  'bot token cannot post as a person, and cannot read a DM between two people '
  'at all, so DMs are out of reach by design rather than by omission.'
) on conflict (key) do nothing;
