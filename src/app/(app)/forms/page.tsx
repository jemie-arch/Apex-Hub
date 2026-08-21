import { FileText } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { tenant } from '@/config/tenant.config';
import { formatCount, formatDateTimeInZone, humanise } from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Forms' };

/** Fields worth showing in a summary row; the rest stay in the payload. */
const SUMMARY_FIELDS = [
  'practice_name',
  'contact_name',
  // Portal invite requests use bare name/role; onboarding uses the rest.
  'name',
  'role',
  'email',
  'phone',
  'address',
  'city',
  'website',
];

function summarise(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];

  const record = payload as Record<string, unknown>;
  const parts: string[] = [];

  for (const field of SUMMARY_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value.trim() !== '') {
      parts.push(`${humanise(field)}: ${value}`);
    }
  }

  // Nothing recognised — say how much is in there rather than showing nothing.
  if (parts.length === 0) {
    const count = Object.keys(record).length;
    if (count > 0) parts.push(`${count} field(s) submitted`);
  }

  return parts.slice(0, 4);
}

export default async function FormsPage() {
  const db = serviceClient();

  const [submissions, groups] = await Promise.all([
    db
      .from('form_submissions')
      .select('id, form_key, client_group_id, client_id, submitted_at, payload')
      .order('submitted_at', { ascending: false })
      .limit(150),
    db.from('client_groups').select('id, name'),
  ]);

  if (submissions.error) throw submissions.error;
  if (groups.error) throw groups.error;

  const groupById = new Map((groups.data ?? []).map((r) => [r.id, r.name]));
  const rows = submissions.data ?? [];
  const zone = tenant.defaultTimezone;

  const byKey = new Map<string, number>();
  for (const row of rows) {
    byKey.set(row.form_key, (byKey.get(row.form_key) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        title="Forms"
        description="Submissions from the public forms — Kick-Off and Post Close"
      />

      {byKey.size > 0 ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {[...byKey.entries()].map(([key, count]) => (
            <span
              key={key}
              className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted"
            >
              {humanise(key)}
              <span className="numeric font-semibold text-fg">
                {formatCount(count)}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No submissions yet"
          description={
            'Kick-Off and Post Close submissions land here, and are also ' +
            'upserted back into the CRM so the practice record stays in step.'
          }
          icon={<FileText size={22} />}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Submitted</th>
                  <th className="px-4 py-3 font-medium">Form</th>
                  <th className="px-4 py-3 font-medium">
                    {tenant.vocabulary.client.singular}
                  </th>
                  <th className="px-4 py-3 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-line last:border-0 hover:bg-surface-hover"
                  >
                    <td className="numeric px-4 py-3 text-fg-muted">
                      {formatDateTimeInZone(row.submitted_at, zone, 'd MMM, HH:mm')}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill value={row.form_key} tone="accent" />
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {row.client_group_id ? (
                        <Link
                          href={`/clients/${row.client_group_id}`}
                          className="hover:text-accent"
                        >
                          {groupById.get(row.client_group_id) ?? 'Unknown'}
                        </Link>
                      ) : (
                        <span className="text-fg-subtle">unmatched</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-fg-muted">
                      {summarise(row.payload).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
