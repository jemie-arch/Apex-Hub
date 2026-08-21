import { Target } from 'lucide-react';
import Link from 'next/link';

import { AddLead } from '@/components/leads/AddLead';
import { LeadClassification } from '@/components/leads/LeadRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { tenant } from '@/config/tenant.config';
import {
  formatCount,
  formatDateTimeInZone,
  formatPercent,
  humanise,
} from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';
import type { LeadClassification as Classification } from '@/types/database';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Leads' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const CLASSIFICATIONS = [
  'unclassified',
  'qualified',
  'unqualified',
  'nurture',
  'duplicate',
  'spam',
] as const;

function isClassification(value: string): value is Classification {
  return (CLASSIFICATIONS as readonly string[]).includes(value);
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unclassified', label: 'Unclassified' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'nurture', label: 'Nurture' },
  { key: 'unqualified', label: 'Unqualified' },
] as const;

/**
 * Inbound B2B leads — people who raised a hand at the agency's own ads.
 *
 * A lead is not a deal. It becomes one when somebody decides it is worth
 * selling to, and the link is kept so the funnel reads end to end.
 *
 * The default view is Unclassified rather than All, because the job this page
 * exists for is emptying that queue.
 */
export default async function LeadsPage({ searchParams }: PageProps) {
  const filter = single(searchParams['show']) ?? 'unclassified';

  const db = serviceClient();

  let query = db
    .from('b2b_leads')
    .select(
      'id, name, email, phone, practice_name, channel, campaign_name, classification, deal_id, received_at, notes',
    )
    .order('received_at', { ascending: false })
    .limit(200);

  // Narrowed against the enum rather than passed through: the value comes
  // from the URL, and PostgREST would reject an unknown one with a 400 that
  // reads as a server fault rather than a bad link.
  if (isClassification(filter)) {
    query = query.eq('classification', filter);
  }

  const [leads, counts] = await Promise.all([
    query,
    db.from('b2b_leads').select('classification, deal_id'),
  ]);

  if (leads.error) throw leads.error;
  if (counts.error) throw counts.error;

  const all = counts.data ?? [];
  const total = all.length;
  const qualified = all.filter((row) => row.classification === 'qualified').length;
  const waiting = all.filter(
    (row) => row.classification === 'unclassified',
  ).length;
  const promoted = all.filter((row) => row.deal_id !== null).length;

  const rows = leads.data ?? [];
  const zone = tenant.defaultTimezone;

  return (
    <>
      <PageHeader
        title="Leads"
        description="Inbound B2B leads from the agency's own advertising"
        actions={<AddLead />}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard label="Leads all time" value={formatCount(total)} />
        <KPICard
          label="Qualified"
          value={formatCount(qualified)}
          hint={
            total > 0 ? `${formatPercent(qualified / total)} of all leads` : undefined
          }
        />
        <KPICard
          label="Awaiting a decision"
          value={formatCount(waiting)}
          higherIsBetter={false}
          hint="nobody has classified these yet"
        />
        <KPICard
          label="Became deals"
          value={formatCount(promoted)}
          hint={
            qualified > 0
              ? `${formatPercent(promoted / qualified)} of qualified`
              : undefined
          }
        />
      </section>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((option) => (
          <Link
            key={option.key}
            href={`/leads?show=${option.key}`}
            className={
              filter === option.key
                ? 'rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast'
                : 'rounded-md border border-line px-3 py-1.5 text-xs text-fg-muted hover:text-fg'
            }
          >
            {option.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={
            filter === 'all'
              ? 'No leads yet'
              : `Nothing ${humanise(filter).toLowerCase()}`
          }
          description={
            'Leads arrive from the agency ad forms, and can be added by hand ' +
            'when somebody calls in or is referred. Anything with no name, ' +
            'email or phone is rejected rather than stored — an empty form ' +
            'submission is not a lead.'
          }
          icon={<Target size={22} />}
          action={<AddLead />}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Received</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Came from</th>
                  <th className="px-4 py-3 font-medium">Classification</th>
                  <th className="px-4 py-3 font-medium">Deal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-line last:border-0 hover:bg-surface-hover"
                  >
                    <td className="numeric px-4 py-3 align-top text-fg-muted">
                      {formatDateTimeInZone(row.received_at, zone, 'd MMM, HH:mm')}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="block font-medium text-fg">
                        {row.name ?? row.practice_name ?? 'Unnamed'}
                      </span>
                      {row.practice_name && row.name ? (
                        <span className="block text-xs text-fg-subtle">
                          {row.practice_name}
                        </span>
                      ) : null}
                      {row.notes ? (
                        <span className="mt-1 block max-w-sm text-xs text-fg-subtle">
                          {row.notes}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-fg-muted">
                      {row.email ? <span className="block">{row.email}</span> : null}
                      {row.phone ? (
                        <span className="numeric block">{row.phone}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-fg-muted">
                      <StatusPill value={row.channel} tone="neutral" />
                      {row.campaign_name ? (
                        <span className="mt-1 block truncate">
                          {row.campaign_name}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <LeadClassification id={row.id} value={row.classification} />
                    </td>
                    <td className="px-4 py-3 align-top text-xs">
                      {row.deal_id ? (
                        <Link
                          href="/pipeline"
                          className="text-accent hover:underline"
                        >
                          in pipeline
                        </Link>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
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
