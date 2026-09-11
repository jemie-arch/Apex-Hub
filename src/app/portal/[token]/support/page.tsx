import { notFound } from 'next/navigation';

import {
  SupportThread,
  type SupportComment,
  type SupportTicket,
} from '@/components/portal/SupportThread';
import { resolvePortal } from '@/lib/portal';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Support',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
}

/**
 * Where a practice asks us something and reads the answer.
 *
 * Writes into the same tech_tickets table the team already works from, so a
 * client's problem joins the existing queue rather than a parallel inbox
 * somebody has to remember to check. Every ticket before this one arrived from
 * Slack and none carried a client_group_id, which is why this page had to add
 * the raising half rather than just display what was there — a read-only
 * version would have been empty for every practice, forever.
 *
 * NO FILE ATTACHMENTS, and this is the one piece of the original sketch not
 * built. There is no storage bucket anywhere in this app and no upload path to
 * borrow, so images would mean introducing one, plus the policies and signed
 * URLs around it, plus accepting arbitrary files from outside the company. That
 * is a considered piece of work rather than something to bolt on against a
 * deadline, and a practice can describe a problem in words today. Worth adding
 * next, because a screenshot settles in one glance what a paragraph argues
 * about.
 */
export default async function PortalSupportPage({ params }: PageProps) {
  const portal = await resolvePortal(params.token);
  if (!portal) notFound();

  const db = serviceClient();

  const tickets = await db
    .from('tech_tickets')
    .select('id, title, body, status, created_at, resolution')
    .eq('client_group_id', portal.group.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (tickets.error) throw tickets.error;

  const rows = tickets.data ?? [];

  /*
   * One query for every thread rather than one per ticket. Comments are
   * attached below by id.
   */
  const comments =
    rows.length === 0
      ? { data: [], error: null }
      : await db
          .from('tech_ticket_comments')
          .select('id, ticket_id, author_name, body, created_at, author_id')
          .in(
            'ticket_id',
            rows.map((row) => row.id),
          )
          .order('created_at', { ascending: true });

  if (comments.error) throw comments.error;

  const byTicket = new Map<string, SupportComment[]>();

  for (const comment of comments.data ?? []) {
    const list = byTicket.get(comment.ticket_id) ?? [];
    list.push({
      id: comment.id,
      authorName: comment.author_name,
      body: comment.body,
      createdAt: comment.created_at,
      /*
       * A comment with no author_id came through the portal — staff replies are
       * written by a signed-in Hub user and carry one. That is what decides
       * whose side of the conversation a message is shown on, so it is read
       * from the data rather than guessed from the name.
       */
      fromPractice: comment.author_id === null,
    });
    byTicket.set(comment.ticket_id, list);
  }

  const threads: SupportTicket[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    resolution: row.resolution,
    comments: byTicket.get(row.id) ?? [],
  }));

  return (
    <>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-fg">Support</h2>
        <p className="mt-0.5 max-w-xl text-sm text-fg-muted">
          Anything you need from us — something looking wrong, a change to your
          ads, a question about your numbers. It reaches the team directly and
          the replies appear here.
        </p>
      </div>

      <SupportThread token={params.token} tickets={threads} />
    </>
  );
}
