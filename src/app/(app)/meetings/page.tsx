import { MessagesSquare } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { tenant } from '@/config/tenant.config';
import { formatCount, formatDateTimeInZone, formatDuration } from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Meetings' };

/**
 * Recorded calls with their AI summaries, linked to the client or the b2b lead
 * they concern. A recording attached to neither is still listed — losing it
 * would be worse than showing it unfiled.
 */
export default async function MeetingsPage() {
  const db = serviceClient();

  const [recordings, groups, deals] = await Promise.all([
    db
      .from('call_recordings')
      .select(
        'id, provider, title, recorded_at, duration_seconds, ai_summary, client_group_id, deal_id, recording_url',
      )
      .order('recorded_at', { ascending: false })
      .limit(100),
    db.from('client_groups').select('id, name'),
    db.from('deals').select('id, practice_name'),
  ]);

  if (recordings.error) throw recordings.error;
  if (groups.error) throw groups.error;
  if (deals.error) throw deals.error;

  const groupById = new Map((groups.data ?? []).map((r) => [r.id, r.name]));
  const dealById = new Map((deals.data ?? []).map((r) => [r.id, r.practice_name]));
  const rows = recordings.data ?? [];
  const zone = tenant.defaultTimezone;

  return (
    <>
      <PageHeader
        title="Meetings"
        description="Recorded calls with AI summaries and transcripts"
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No recordings yet"
          description={
            'Recordings arrive from the call recorder once that integration is ' +
            'connected. Nothing is polled for them — they are pushed in as each ' +
            'call finishes.'
          }
          icon={<MessagesSquare size={22} />}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const who = row.client_group_id
              ? groupById.get(row.client_group_id)
              : row.deal_id
                ? dealById.get(row.deal_id)
                : null;

            return (
              <article
                key={row.id}
                className="rounded-lg border border-line bg-surface p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-fg">
                      {row.title ?? 'Untitled call'}
                    </h2>
                    <p className="numeric mt-0.5 text-xs text-fg-subtle">
                      {formatDateTimeInZone(row.recorded_at, zone)} ·{' '}
                      {formatDuration(row.duration_seconds)} · {row.provider}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {who ? (
                      row.client_group_id ? (
                        <Link href={`/clients/${row.client_group_id}`}>
                          <StatusPill value={who} tone="accent" />
                        </Link>
                      ) : (
                        <StatusPill value={who} tone="neutral" />
                      )
                    ) : (
                      <StatusPill value="unlinked" tone="warning" />
                    )}
                  </div>
                </div>

                {row.ai_summary ? (
                  <p className="mt-3 text-sm text-fg-muted">{row.ai_summary}</p>
                ) : (
                  <p className="mt-3 text-sm text-fg-subtle">
                    No summary — the transcript may still be processing.
                  </p>
                )}

                {row.recording_url ? (
                  <a
                    href={row.recording_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-block text-xs text-accent hover:underline"
                  >
                    Open recording
                  </a>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {rows.length > 0 ? (
        <p className="mt-4 text-xs text-fg-subtle">
          {formatCount(rows.length)} most recent. An unlinked recording means we
          could not match it to a {tenant.vocabulary.client.singular} or a lead
          — it is shown rather than hidden.
        </p>
      ) : null}
    </>
  );
}
