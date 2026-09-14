/**
 * Screenshots and documents on a tech support ticket.
 *
 * The bucket is private and there is no storage policy on it, so nothing here
 * works without the service role. That is the design: every caller is proved
 * first — the Hub through requirePermission, the portal by resolving a token to
 * exactly one group — and then this runs. A public bucket would turn a
 * screenshot of somebody's inbox into a URL that needs no login and never
 * expires.
 */
import { randomUUID } from 'node:crypto';

import { serviceClient } from '@/lib/supabase/service';

export const BUCKET = 'ticket-attachments';

/** Mirrors the bucket's own allowlist, so a bad type fails before the upload. */
export const ALLOWED_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
];

/** 10 MB. A screenshot is under 2; a photograph of a screen is under 8. */
export const MAX_BYTES = 10 * 1024 * 1024;

/** How long a view link lives. Long enough to read a ticket, not to share one. */
const SIGNED_URL_SECONDS = 60 * 30;

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  commentId: string | null;
  uploadedByName: string | null;
  /** Null when the link could not be signed. The row still renders. */
  url: string | null;
}

export interface UploadOutcome {
  ok: boolean;
  message: string;
  attachmentId?: string;
}

/**
 * The extension to store the object under.
 *
 * Taken from the MIME type rather than from the uploaded filename, which is
 * attacker-controlled text. The original name is kept in the database for
 * display and is never used to build a path.
 */
function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  return 'pdf';
}

/** Trimmed for display, and only for display. */
function safeName(name: string): string {
  const trimmed = name.trim().slice(0, 200);
  return trimmed === '' ? 'attachment' : trimmed;
}

export async function attachToTicket(input: {
  ticketId: string;
  commentId?: string | null;
  file: File;
  uploadedBy?: string | null;
  uploadedByName?: string | null;
}): Promise<UploadOutcome> {
  const { file } = input;

  if (file.size === 0) {
    return { ok: false, message: 'That file is empty.' };
  }

  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      message: 'That file is over 10 MB. Screenshots are usually well under.',
    };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      ok: false,
      message: 'Only images and PDFs can be attached.',
    };
  }

  const db = serviceClient();

  /*
   * Path is ticket id then a fresh uuid. Nothing from the uploaded filename
   * reaches it, so no amount of "../" or unicode in a name can write outside
   * the ticket's own folder.
   */
  const path = `${input.ticketId}/${randomUUID()}.${extensionFor(file.type)}`;

  const uploaded = await db.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (uploaded.error) {
    return { ok: false, message: 'Could not upload that. Try again.' };
  }

  const row = await db
    .from('tech_ticket_attachments')
    .insert({
      ticket_id: input.ticketId,
      comment_id: input.commentId ?? null,
      storage_path: path,
      file_name: safeName(file.name),
      mime_type: file.type,
      size_bytes: file.size,
      uploaded_by: input.uploadedBy ?? null,
      uploaded_by_name: input.uploadedByName ?? null,
    })
    .select('id')
    .single();

  if (row.error) {
    /*
     * The object is already in the bucket and nothing references it. Removed
     * rather than left: an orphan here is a file nobody can see, nobody can
     * delete through the app, and which still counts against storage.
     */
    await db.storage.from(BUCKET).remove([path]);
    return { ok: false, message: 'Could not save that. Try again.' };
  }

  return { ok: true, message: 'Attached.', attachmentId: row.data.id };
}

/**
 * Attachments for a set of tickets, with a signed link each.
 *
 * Signed per render rather than stored, because a stored URL either expires and
 * breaks or never expires and leaks. One round trip per object is the cost of
 * that, and a ticket has a handful at most.
 */
export async function attachmentsFor(
  ticketIds: readonly string[],
): Promise<Map<string, Attachment[]>> {
  const byTicket = new Map<string, Attachment[]>();
  if (ticketIds.length === 0) return byTicket;

  const db = serviceClient();

  const rows = await db
    .from('tech_ticket_attachments')
    .select(
      'id, ticket_id, comment_id, storage_path, file_name, mime_type, size_bytes, uploaded_by_name',
    )
    .in('ticket_id', [...ticketIds])
    .order('created_at', { ascending: true });

  if (rows.error || !rows.data || rows.data.length === 0) return byTicket;

  const signed = await db.storage
    .from(BUCKET)
    .createSignedUrls(
      rows.data.map((row) => row.storage_path),
      SIGNED_URL_SECONDS,
    );

  const urlByPath = new Map<string, string>();
  for (const entry of signed.data ?? []) {
    if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
  }

  for (const row of rows.data) {
    const list = byTicket.get(row.ticket_id) ?? [];
    list.push({
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes ?? 0),
      commentId: row.comment_id,
      uploadedByName: row.uploaded_by_name,
      url: urlByPath.get(row.storage_path) ?? null,
    });
    byTicket.set(row.ticket_id, list);
  }

  return byTicket;
}
