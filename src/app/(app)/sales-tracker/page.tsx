import { Target } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import {
  formatCount,
  formatDateInZone,
  formatMoney,
  humanise,
} from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';
import type { DealStage } from '@/types/database';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Sales tracker' };

function stageTone(stage: DealStage): Tone {
  switch (stage) {
    case 'won':
      return 'positive';
    case 'lost':
      return 'negative';
    case 'proposal':
    case 'call_showed':
      return 'warning';
    case 'call_booked':
      return 'accent';
    default:
      return 'neutral';
  }
}

/**
 * Every prospect ever spoken to, with how it ended. The pipeline board shows
 * what is live; this is the record, including everything lost.
 */
export default async function SalesTrackerPage() {
  const db = serviceClient();

  const [deals, owners, groups] = await Promise.all([
    db
      .from('deals')
      // Must stay one literal — see the note in clients/[id]/page.tsx.
      .select(
        'id, practice_name, contact_name, stage, value_cents, currency, source, owner_user_id, client_group_id, lost_reason, first_contact_at, won_at, lost_at, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(1000),
    db.from('user_profiles').select('id, full_name, email'),
    db.from('client_groups').select('id, name'),
  ]);

  if (deals.error) throw deals.error;
  if (owners.error) throw owners.error;
  if (groups.error) throw groups.error;

  const ownerById = new Map(
    (owners.data ?? []).map((row) => [row.id, row.full_name ?? row.email]),
  );
  const groupById = new Map((groups.data ?? []).map((row) => [row.id, row.name]));

  const all = deals.data ?? [];
  const won = all.filter((deal) => deal.stage === 'won').length;
  const lost = all.filter((deal) => deal.stage === 'lost').length;
  const zone = tenant.defaultTimezone;
  const client = tenant.vocabulary.client;

  return (
    <>
      <PageHeader
        title="Sales tracker"
        description={
          `${formatCount(all.length)} prospects · ${formatCount(won)} won · ` +
          `${formatCount(lost)} lost`
        }
      />

      {all.length === 0 ? (
        <EmptyState
          title="No prospects recorded"
          description={
            'This is the full history of the ' +
            `${tenant.funnels.b2b.toLowerCase()} funnel. It fills up once the ` +
            'crm-deals sync is built.'
          }
          icon={<Target size={22} />}
        />
      ) : (
        <div className="panel overflow-hidden rounded-lg border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Practice</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Stage</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 text-right font-medium">Value</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {all.map((deal) => {
                  const groupName = deal.client_group_id
                    ? groupById.get(deal.client_group_id)
                    : null;

                  return (
                    <tr
                      key={deal.id}
                      className="border-b border-line last:border-0 hover:bg-surface-hover"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-fg">
                          {deal.practice_name}
                        </span>
                        <span className="numeric block text-xs text-fg-subtle">
                          first contact{' '}
                          {formatDateInZone(deal.first_contact_at, zone, 'd MMM yy')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {deal.contact_name ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          value={deal.stage}
                          tone={stageTone(deal.stage)}
                        />
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {deal.owner_user_id
                          ? (ownerById.get(deal.owner_user_id) ?? '—')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {deal.source ?? '—'}
                      </td>
                      <td className="numeric px-4 py-3 text-right text-fg-muted">
                        {deal.value_cents === null
                          ? '—'
                          : formatMoney(deal.value_cents, deal.currency)}
                      </td>
                      <td className="px-4 py-3 text-xs text-fg-muted">
                        {/* A won deal links to the client it became — the one
                            place the two funnels join up. */}
                        {groupName ? (
                          <Link
                            href={`/clients/${deal.client_group_id}`}
                            className="text-accent hover:underline"
                          >
                            {titleCase(client.singular)}: {groupName}
                          </Link>
                        ) : deal.lost_reason ? (
                          humanise(deal.lost_reason)
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
