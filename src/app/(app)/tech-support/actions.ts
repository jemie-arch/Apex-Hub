'use server';

/**
 * Tech-call bookings.
 *
 * A request arrives with a preferred time at best; confirming it is what turns
 * it into an appointment, and confirming is deliberately an explicit act rather
 * than something that happens by a row appearing.
 */
import { revalidatePath } from 'next/cache';

import { ASSIGNABLE_ROLES } from '@/config/roles';
import { notifyUsers } from '@/lib/notify/inbox';
import { requireAdmin, requirePermission } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';

type TechCallStatus = Database['public']['Enums']['tech_call_status'];

const STATUSES: readonly TechCallStatus[] = [
  'requested',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
];

export interface TechCallResult {
  ok: boolean;
  message: string;
}

function clean(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export async function createTechCall(
  formData: FormData,
): Promise<TechCallResult> {
  await requireAdmin();

  const topic = clean(formData.get('topic'));
  if (topic === null) return { ok: false, message: 'Say what the call is about.' };

  const scheduled = clean(formData.get('scheduled_at'));

  const written = await serviceClient()
    .from('tech_calls')
    .insert({
      client_group_id: clean(formData.get('client_group_id')),
      requested_by: clean(formData.get('requested_by')),
      contact_email: clean(formData.get('contact_email')),
      contact_phone: clean(formData.get('contact_phone')),
      topic,
      detail: clean(formData.get('detail')),
      // A datetime-local value carries no zone. It is interpreted as the
      // viewer's, which is what somebody typing a time into this form means.
      scheduled_at: scheduled === null ? null : new Date(scheduled).toISOString(),
    });

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/tech-support');
  return { ok: true, message: 'Booking added.' };
}

export async function setTechCallStatus(input: {
  id: string;
  status: string;
  scheduledAt?: string | null;
  resolution?: string | null;
}): Promise<TechCallResult> {
  const caller = await requireAdmin();

  if (!(STATUSES as readonly string[]).includes(input.status)) {
    return { ok: false, message: `"${input.status}" is not a status.` };
  }

  const status = input.status as TechCallStatus;

  // Confirming without a time would leave a "confirmed" call nobody can attend.
  if (status === 'confirmed' && !input.scheduledAt) {
    return { ok: false, message: 'Set the time you are confirming it for.' };
  }

  const patch: Database['public']['Tables']['tech_calls']['Update'] = { status };

  if (input.scheduledAt) {
    patch.scheduled_at = new Date(input.scheduledAt).toISOString();
  }
  if (input.resolution !== undefined) {
    patch.resolution =
      input.resolution === null || input.resolution.trim() === ''
        ? null
        : input.resolution.trim();
  }
  if (status === 'confirmed') {
    patch.confirmed_by = caller.id;
    patch.confirmed_at = new Date().toISOString();
  }

  const written = await serviceClient()
    .from('tech_calls')
    .update(patch)
    .eq('id', input.id);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/tech-support');
  return { ok: true, message: 'Updated.' };
}

/* ===========================================================================
 * TICKETS
 *
 * Separate from the calls above because they are a different thing: a call is
 * a booking with a time and somebody to tell, a ticket is a piece of work.
 * Most arrive from Slack — see /api/slack/events.
 *
 * These are guarded by requirePermission('tech_support') rather than
 * requireAdmin. Ally is role 'tech' and every Slack ticket is assigned to her;
 * under requireAdmin she could read her own queue and not move a single ticket
 * out of it, which would make the whole thing ornamental.
 * ======================================================================== */

type TechTicketStatus = Database['public']['Enums']['tech_ticket_status'];
type TechTicketPriority = Database['public']['Enums']['tech_ticket_priority'];

const TICKET_STATUSES: readonly TechTicketStatus[] = [
  'open',
  'in_progress',
  'resolved',
  'closed',
];

const TICKET_PRIORITIES: readonly TechTicketPriority[] = [
  'low',
  'normal',
  'high',
  'urgent',
];

export async function setTicketStatus(input: {
  id: string;
  status: string;
  resolution?: string | null;
}): Promise<TechCallResult> {
  const caller = await requirePermission('tech_support');

  if (!(TICKET_STATUSES as readonly string[]).includes(input.status)) {
    return { ok: false, message: `"${input.status}" is not a status.` };
  }

  const status = input.status as TechTicketStatus;
  const patch: Database['public']['Tables']['tech_tickets']['Update'] = {
    status,
  };

  if (input.resolution !== undefined) {
    patch.resolution =
      input.resolution === null || input.resolution.trim() === ''
        ? null
        : input.resolution.trim();
  }

  if (status === 'resolved' || status === 'closed') {
    patch.resolved_at = new Date().toISOString();
    patch.resolved_by = caller.id;
  } else {
    // Reopening clears the closure rather than leaving a resolved_at on an
    // open ticket, which would make "how long did this take" answer nonsense.
    patch.resolved_at = null;
    patch.resolved_by = null;
  }

  const written = await serviceClient()
    .from('tech_tickets')
    .update(patch)
    .eq('id', input.id);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/tech-support');
  return { ok: true, message: 'Updated.' };
}

/**
 * Hand a ticket to somebody else, or to nobody.
 *
 * Unassigning is deliberately possible. A ticket nobody owns is a real state —
 * it is what the Slack route produces when TECH_SUPPORT_ASSIGNEE_EMAIL matches
 * no Hub user — and hiding it behind a required value would mean the only way
 * to take a ticket off someone is to put it on someone else.
 */
export async function assignTicket(input: {
  id: string;
  userId: string | null;
}): Promise<TechCallResult> {
  const caller = await requirePermission('tech_support');
  const db = serviceClient();

  const written = await db
    .from('tech_tickets')
    .update({ assigned_to: input.userId })
    .eq('id', input.id)
    .select('title')
    .maybeSingle();

  if (written.error) return { ok: false, message: written.error.message };

  /*
   * Being handed a ticket is the one thing that most deserves a notification:
   * it is work that has just become yours, decided by somebody else, with no
   * other signal that it happened. Unassigning notifies nobody — there is no
   * recipient — and taking a ticket yourself notifies nobody either, which
   * notifyUsers handles through actorId.
   */
  if (input.userId) {
    await notifyUsers({
      userIds: [input.userId],
      actorId: caller.id,
      kind: 'info',
      title: `You were assigned "${written.data?.title ?? 'a tech ticket'}"`,
      href: `/tech-support/${input.id}`,
    });
  }

  revalidatePath('/tech-support');
  revalidatePath(`/tech-support/${input.id}`);
  return { ok: true, message: 'Assigned.' };
}

/**
 * Correct a priority.
 *
 * The Slack route only ever sets this from an explicit #urgent / #high / #low
 * tag, so most tickets arrive 'normal' whatever the person meant. This is where
 * that gets fixed, by somebody who has read it.
 */
export async function setTicketPriority(input: {
  id: string;
  priority: string;
}): Promise<TechCallResult> {
  await requirePermission('tech_support');

  if (!(TICKET_PRIORITIES as readonly string[]).includes(input.priority)) {
    return { ok: false, message: `"${input.priority}" is not a priority.` };
  }

  const written = await serviceClient()
    .from('tech_tickets')
    .update({ priority: input.priority as TechTicketPriority })
    .eq('id', input.id);

  if (written.error) return { ok: false, message: written.error.message };

  revalidatePath('/tech-support');
  return { ok: true, message: 'Updated.' };
}

/* ===========================================================================
 * COMMENTS
 *
 * The conversation about a ticket, and telling the people it concerns.
 * ======================================================================== */

/** Longer than this and it is a document, not a comment. */
const COMMENT_LIMIT = 8000;

export interface CommentResult extends TechCallResult {
  /** How many people were told. Reported back so the writer can see it. */
  notified?: number;
}

/**
 * Add a comment, and notify the people it concerns.
 *
 * WHO GETS TOLD, AND WHY THOSE PEOPLE
 *
 * Everyone tagged, plus the ticket's assignee. The assignee is included even
 * when nobody tagged them, because a comment on a ticket somebody owns is
 * addressed to them whether or not the writer typed their name — and the
 * alternative is a ticket where the owner has to keep checking the page to
 * find out something happened.
 *
 * Never the author, however they were reached. See notifyUsers.
 *
 * The mentioned ids are validated against staff rather than trusted. They
 * arrive from a browser and are written into a column that decides who gets
 * notified and, through RLS, who can read the thread; an id that is not a
 * teammate has no business in either.
 */
export async function addTicketComment(input: {
  ticketId: string;
  body: string;
  mentionedUserIds?: readonly string[];
}): Promise<CommentResult> {
  const caller = await requirePermission('tech_support');

  const body = input.body.trim();
  if (body === '') return { ok: false, message: 'Say something first.' };
  if (body.length > COMMENT_LIMIT) {
    return { ok: false, message: 'That is too long for a comment.' };
  }

  const db = serviceClient();

  const ticket = await db
    .from('tech_tickets')
    .select('id, title, assigned_to')
    .eq('id', input.ticketId)
    .maybeSingle();

  if (ticket.error) return { ok: false, message: ticket.error.message };
  if (!ticket.data) return { ok: false, message: 'That ticket no longer exists.' };

  // Only real teammates, and only ones that exist. An unknown id is dropped
  // silently rather than failing the comment: the words are what matter, and
  // refusing to save them over a stale mention would be the wrong trade.
  const claimed = [...new Set(input.mentionedUserIds ?? [])];
  let mentioned: string[] = [];

  if (claimed.length > 0) {
    const people = await db
      .from('user_profiles')
      .select('id')
      .in('id', claimed)
      .in('role', [...ASSIGNABLE_ROLES]);

    mentioned = (people.data ?? []).map((row) => row.id);
  }

  const author = await db
    .from('user_profiles')
    .select('full_name, email')
    .eq('id', caller.id)
    .maybeSingle();

  const authorName =
    author.data?.full_name?.trim() || author.data?.email || 'Somebody';

  const written = await db.from('tech_ticket_comments').insert({
    ticket_id: input.ticketId,
    author_id: caller.id,
    author_name: authorName,
    body,
    mentioned_user_ids: mentioned,
  });

  if (written.error) return { ok: false, message: written.error.message };

  /*
   * Notifications are written after the comment, never in the same breath.
   * A failure here must not roll back the comment — the words are saved and
   * visible on the ticket either way, and notifyUsers swallows its own errors
   * for exactly that reason.
   */
  const notified = await notifyUsers({
    userIds: [...mentioned, ticket.data.assigned_to],
    actorId: caller.id,
    kind: 'info',
    title: `${authorName} commented on "${ticket.data.title}"`,
    // Trimmed: the bell is a prompt to go and read, not the reading itself.
    body: body.length > 160 ? `${body.slice(0, 157)}…` : body,
    href: `/tech-support/${input.ticketId}`,
  });

  revalidatePath('/tech-support');
  revalidatePath(`/tech-support/${input.ticketId}`);

  return { ok: true, message: 'Added.', notified };
}
