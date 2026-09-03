-- Comments on a tech ticket, and being told when somebody tags you in one.
--
-- A ticket that can only be moved between four statuses is a to-do item. The
-- work happens in the conversation about it -- "which practice?", "try
-- reconnecting the calendar", "still broken" -- and until now that conversation
-- had nowhere to go except back to Slack, where it scrolls away and is lost to
-- anybody who reads the ticket next week.
--
-- WHY mentioned_user_ids IS THE TRUTH AND THE TEXT IS NOT
--
-- The composer inserts a person's name into the body and records their id in
-- this column at the same time. Both are stored, and they are not redundant:
--
--   body                "@Ally can you look at this"
--   mentioned_user_ids  {10f88dd8-...}
--
-- The array is authoritative and the text is display. Re-deriving ids by
-- matching "@Ally" against user_profiles at read time would be a guess, and two
-- people called Ally would make it a wrong guess that notifies the wrong
-- person. Storing only ids would mean a comment renders as a uuid the moment
-- the rendering code has a bad day.
--
-- The consequence worth knowing: editing the body afterwards does not change
-- who was notified, because they already were. That is correct -- a
-- notification is an event that happened, not a view over current text.
--
-- WHY author_name EXISTS ALONGSIDE author_id
--
-- Same reason tech_tickets.raised_by_name does. The foreign key goes null when
-- somebody leaves, and a comment thread where half the authors have become
-- blank is unreadable. This one is set at write time and never updated.

create table tech_ticket_comments (
  id                 uuid primary key default gen_random_uuid(),

  ticket_id          uuid not null
                       references tech_tickets (id) on delete cascade,

  author_id          uuid references user_profiles (id) on delete set null,
  author_name        text,

  body               text not null,

  -- Who was tagged, as captured by the composer. See the note above.
  mentioned_user_ids uuid[] not null default '{}',

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table tech_ticket_comments is
  'The conversation about a tech ticket. Deleted with its ticket.';

comment on column tech_ticket_comments.mentioned_user_ids is
  'Authoritative list of who was tagged, captured by the composer at write time. The @names in body are display only -- never re-derive ids from the text, because two people can share a name.';

create index tech_ticket_comments_ticket_idx
  on tech_ticket_comments (ticket_id, created_at);

-- Answers "what was I tagged in" without scanning every comment.
create index tech_ticket_comments_mentions_idx
  on tech_ticket_comments using gin (mentioned_user_ids);

create trigger tech_ticket_comments_set_updated_at
  before update on tech_ticket_comments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS, matching tech_tickets. The page reads through the service role; these
-- cover a signed-in browser client.
alter table tech_ticket_comments enable row level security;

create policy admin_all on tech_ticket_comments
  for all using (auth_is_admin()) with check (auth_is_admin());

-- A non-admin reads the thread of a ticket they are part of: they wrote the
-- comment, they were tagged in it, or the ticket itself is theirs. Ally is role
-- 'tech' and owns most tickets, so without this she could open a ticket and see
-- an empty conversation.
create policy participant_read on tech_ticket_comments
  for select using (
    author_id = auth.uid()
    or auth.uid() = any (mentioned_user_ids)
    or exists (
      select 1 from tech_tickets t
      where t.id = ticket_id
        and (t.assigned_to = auth.uid() or t.raised_by = auth.uid())
    )
  );
