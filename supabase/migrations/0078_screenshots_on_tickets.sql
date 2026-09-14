/*
 * Attachments on tech support tickets.
 *
 * Asked for because a screenshot settles in one glance what a paragraph argues
 * about, and every ticket describing a broken screen currently has to describe
 * it in words.
 *
 * A correction first, since it is recorded wrongly elsewhere: I said this app
 * had no storage. It has a `creatives` bucket, private, created on 8 September.
 * It holds zero objects and no migration created it — somebody made it in the
 * dashboard — so it is real but invisible to anyone reading the repo, which is
 * how I came to miss it. This bucket is created in a migration for that reason.
 *
 * PRIVATE, and that is not a default. A ticket screenshot is the most likely
 * place in this system for a patient's name, a phone number or a full inbox to
 * arrive by accident. A public bucket would make every one of those a URL that
 * needs no login and never expires. Everything is served through short-lived
 * signed links generated per render instead.
 *
 * The mime allowlist is images and PDF. Not because other files are unsafe to
 * store, but because this is an inbox open to clients through the portal's
 * support page, and "upload anything" plus "we will hand it back on a link" is
 * how a system ends up distributing somebody else's executable.
 *
 * 10 MB rather than the creatives bucket's 200 MB. A screenshot is under 2 MB;
 * a phone photograph of a screen is under 8. Anything larger is a video, which
 * belongs in a Loom link in the comment.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  false,
  10485760,
  array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/*
 * No storage policy is added, deliberately.
 *
 * Every read and write goes through a server action using the service role,
 * which bypasses RLS — the Hub authenticates the caller first, and the portal
 * resolves its token to one group before it touches anything. Adding a policy
 * that grants direct client access would widen the surface past what any code
 * path actually needs, and a bucket nobody can reach except through our own
 * checks is the stronger position.
 */

create table if not exists public.tech_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tech_tickets(id) on delete cascade,
  /*
   * Which comment it arrived with, when it arrived with one. Null means it was
   * attached to the ticket itself. Nullable rather than two tables: an image is
   * an image, and the only thing that differs is where it is shown.
   */
  comment_id uuid references public.tech_ticket_comments(id) on delete cascade,
  storage_path text not null unique,
  /* What the uploader called it. Shown to people; never used as a path. */
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  /* Null for anything uploaded through the client portal - see 0072's reasoning. */
  uploaded_by uuid references public.user_profiles(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists tech_ticket_attachments_ticket_idx
  on public.tech_ticket_attachments (ticket_id, created_at);

alter table public.tech_ticket_attachments enable row level security;

/*
 * No policy, so service-role only — the same rule the rest of the ticket tables
 * follow. Both readers of this table already prove who is asking before they
 * query it.
 */

comment on table public.tech_ticket_attachments is
  'Screenshots and documents on tech support tickets. Objects live in the private ticket-attachments bucket and are served through short-lived signed URLs.';
