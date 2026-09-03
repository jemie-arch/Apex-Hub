/**
 * The in-app inbox — what the bell in the top right is counting.
 *
 * Sits beside notify/slack.ts and does the opposite job. That one shouts at a
 * channel when a sync breaks; this one puts a row in front of one named person
 * and waits for them to read it. A sync failure concerns whoever is on duty; a
 * mention concerns exactly the person mentioned, and posting it to #tech-team
 * would be both noisier and less likely to reach them.
 *
 * The notifications table has existed since 0001 with nothing writing to it.
 * This is the first writer, which is why the shape below is conservative: one
 * row per person per event, an href to the thing it is about, and no grouping
 * or digesting. Grouping is worth adding when somebody complains about volume,
 * and not before — a "3 new comments" summary that collapses the one mention
 * that mattered is a worse failure than three rows.
 *
 * Best-effort throughout, like the Slack alerts. A comment that was written is
 * the durable fact; failing to tell somebody about it must never mean failing
 * to save it. So this logs and returns rather than throwing.
 */
import { serviceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';

type NotificationKind = Database['public']['Enums']['notification_kind'];

export interface InboxMessage {
  /** Who to tell. Deduplicated here, so callers may pass overlapping lists. */
  userIds: readonly (string | null | undefined)[];
  kind?: NotificationKind;
  title: string;
  body?: string | null;
  /** Where the bell should send them. Relative, e.g. /tech-support/<id>. */
  href?: string | null;
  /**
   * The person who caused this, who is never told about their own action.
   *
   * Without it, tagging yourself in a comment — which people do, writing
   * "@me to follow up" — puts a notification in your own bell for something
   * you just typed, and the bell stops meaning "somebody needs you".
   */
  actorId?: string | null;
}

/**
 * Writes one notification per distinct recipient. Returns how many landed.
 *
 * The count is returned rather than a boolean because the caller sometimes
 * wants to say "3 people notified" back to the person who wrote the comment,
 * and because zero is a legitimate outcome worth being able to see: a comment
 * mentioning only its own author notifies nobody, correctly.
 */
export async function notifyUsers(message: InboxMessage): Promise<number> {
  const recipients = [
    ...new Set(
      message.userIds.filter(
        (id): id is string =>
          typeof id === 'string' && id !== '' && id !== message.actorId,
      ),
    ),
  ];

  if (recipients.length === 0) return 0;

  const rows = recipients.map((userId) => ({
    user_id: userId,
    kind: message.kind ?? ('info' as NotificationKind),
    title: message.title,
    body: message.body ?? null,
    href: message.href ?? null,
  }));

  const written = await serviceClient().from('notifications').insert(rows);

  if (written.error) {
    console.error('[inbox] could not write notifications:', written.error.message);
    return 0;
  }

  return rows.length;
}
