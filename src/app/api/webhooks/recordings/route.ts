/**
 * Inbound call recordings.
 *
 * Pushed in as each call finishes rather than polled, because a recorder knows
 * when a call ended and we would otherwise be asking every few minutes for
 * something that happens a handful of times a day.
 *
 * Guarded by CRON_SECRET, accepted either as `Authorization: Bearer <secret>`
 * or as `?secret=` for recorders whose webhook configuration has no header
 * field. The query form is second-best — it lands in access logs — so the
 * header is what to use where the option exists.
 *
 * The payload shape is written against Fathom's documented webhook and is NOT
 * verified against a live call. Every field is read through a guard and an
 * unrecognised body is answered with 422 and a stored reason rather than a
 * silent 200, so the first real call will say what it actually sent.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { serverEnv } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface Parsed {
  externalId: string;
  provider: string;
  title: string | null;
  recordedAt: string;
  durationSeconds: number;
  summary: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  participantEmails: string[];
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

function asSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

/** Pulls email addresses out of whatever shape the participant list takes. */
function readEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.includes('@')) {
      out.push(entry.toLowerCase());
      continue;
    }
    if (typeof entry === 'object' && entry !== null) {
      const record = entry as Record<string, unknown>;
      const email = asString(record['email']) ?? asString(record['emailAddress']);
      if (email && email.includes('@')) out.push(email.toLowerCase());
    }
  }
  return [...new Set(out)];
}

function parse(body: unknown): Parsed | string {
  if (typeof body !== 'object' || body === null) return 'body was not an object';

  const root = body as Record<string, unknown>;

  // Recorders vary between a flat body and one wrapped in `recording`,
  // `meeting` or `data`. Take the first that looks like the payload.
  const nested = ['recording', 'meeting', 'data', 'call']
    .map((key) => root[key])
    .find((value) => typeof value === 'object' && value !== null) as
    | Record<string, unknown>
    | undefined;

  const record = nested ?? root;

  const externalId =
    asString(record['id']) ??
    asString(record['recording_id']) ??
    asString(record['meeting_id']) ??
    asString(root['id']);

  if (!externalId) return 'no id field found on the payload';

  const recordedAtRaw =
    asString(record['recorded_at']) ??
    asString(record['started_at']) ??
    asString(record['created_at']) ??
    asString(record['scheduled_start_time']);

  const recordedAt = recordedAtRaw ? new Date(recordedAtRaw) : new Date();
  if (Number.isNaN(recordedAt.getTime())) {
    return `could not read a date from "${recordedAtRaw ?? ''}"`;
  }

  return {
    externalId,
    provider: asString(root['provider']) ?? 'fathom',
    title: asString(record['title']) ?? asString(record['meeting_title']),
    recordedAt: recordedAt.toISOString(),
    durationSeconds: asSeconds(
      record['duration_seconds'] ?? record['duration'] ?? record['length'],
    ),
    summary:
      asString(record['ai_summary']) ??
      asString(record['summary']) ??
      asString(record['default_summary']),
    transcript: asString(record['transcript']) ?? asString(record['transcript_text']),
    recordingUrl:
      asString(record['recording_url']) ??
      asString(record['url']) ??
      asString(record['share_url']),
    participantEmails: readEmails(
      record['participants'] ?? record['attendees'] ?? record['invitees'],
    ),
  };
}

function authorised(request: NextRequest): boolean {
  const expected = serverEnv().CRON_SECRET;

  const header = request.headers.get('authorization');
  const bearer = header?.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : null;
  const query = request.nextUrl.searchParams.get('secret');

  return bearer === expected || query === expected;
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body was not JSON' }, { status: 400 });
  }

  const parsed = parse(body);
  if (typeof parsed === 'string') {
    // 422 with the reason, not 200. A recorder that retries on failure is
    // exactly what we want while the mapping is still unproven.
    return NextResponse.json(
      { error: parsed, keys: Object.keys(body as object).slice(0, 40) },
      { status: 422 },
    );
  }

  const db = serviceClient();

  // Attribution by participant email: the practice contact, then a b2b deal
  // contact. An unmatched recording is still stored — the Meetings page shows
  // unlinked calls rather than hiding them, because a lost recording is worse
  // than an unfiled one.
  let clientGroupId: string | null = null;
  let dealId: string | null = null;

  if (parsed.participantEmails.length > 0) {
    const group = await db
      .from('client_groups')
      .select('id')
      .in('contact_email', parsed.participantEmails)
      .maybeSingle();

    if (!group.error && group.data) clientGroupId = group.data.id;

    if (clientGroupId === null) {
      const deal = await db
        .from('deals')
        .select('id, client_group_id')
        .in('contact_email', parsed.participantEmails)
        .maybeSingle();

      if (!deal.error && deal.data) {
        // The deal only — call_recordings_one_owner forbids setting both, and
        // a recording of a sales call belongs to the deal even when the deal
        // already points at a business.
        dealId = deal.data.id;
      }
    }
  }

  const written = await db.from('call_recordings').upsert(
    {
      provider: parsed.provider,
      external_id: parsed.externalId,
      title: parsed.title,
      recorded_at: parsed.recordedAt,
      duration_seconds: parsed.durationSeconds,
      ai_summary: parsed.summary,
      transcript: parsed.transcript,
      recording_url: parsed.recordingUrl,
      client_group_id: clientGroupId,
      deal_id: dealId,
      participants: parsed.participantEmails,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'provider,external_id' },
  );

  if (written.error) {
    return NextResponse.json({ error: written.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    externalId: parsed.externalId,
    linkedTo: clientGroupId ? 'client' : dealId ? 'deal' : 'nothing yet',
  });
}
