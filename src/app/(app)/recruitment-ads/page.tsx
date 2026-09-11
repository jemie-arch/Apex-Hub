import { UserRoundSearch } from 'lucide-react';

import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { tenant } from '@/config/tenant.config';
import { formatCount, formatMoney, formatPercent } from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Recruitment ads' };

/**
 * What we spend advertising for staff, reported on its own terms.
 *
 * Ad Account 13 reported 119 of the fleet's leads on $526 — three quarters of
 * all reported lead volume, at $4.42 each against $40 to $108 for a dental
 * patient. A figure an order of magnitude below the rest is a different
 * product, and that product is job applicants. Migration 0069 mapped it to an
 * internal client so the spend became visible without ever touching a
 * practice's numbers.
 *
 * That left the view with nowhere to be seen. Joshua asked for campaign name,
 * cost per lead and amount spent; this is those three columns, and until now
 * they existed only as SQL.
 *
 * Cost per lead is blank rather than zero where no lead was recorded — the
 * same rule the client tracker follows. A cost per lead of nothing is a claim,
 * not a measurement.
 */
export default async function RecruitmentAdsPage() {
  const db = serviceClient();

  const { data, error } = await db
    .from('v_recruitment_ads')
    .select(
      'account_name, campaign_name, first_day, last_day, spend, impressions, clicks, leads, cost_per_lead',
    )
    .order('spend', { ascending: false, nullsFirst: false });

  if (error) throw error;

  const rows = data ?? [];
  const currency = tenant.defaultCurrency;

  const totals = rows.reduce(
    (sum, row) => ({
      spend: sum.spend + Number(row.spend ?? 0),
      leads: sum.leads + Number(row.leads ?? 0),
      clicks: sum.clicks + Number(row.clicks ?? 0),
      impressions: sum.impressions + Number(row.impressions ?? 0),
    }),
    { spend: 0, leads: 0, clicks: 0, impressions: 0 },
  );

  /* Aggregate then divide. A mean of per-campaign costs would weight a
     three-day campaign the same as a fortnight's. */
  const blendedCpl = totals.leads === 0 ? null : totals.spend / totals.leads;

  return (
    <>
      <PageHeader
        eyebrow="Hiring"
        title="Recruitment ads"
        description={
          blendedCpl === null ? (
            'What we spend advertising for staff'
          ) : (
            <>
              {formatCount(totals.leads)} applicants at{' '}
              <span className="numeric text-accent">
                {formatMoney(Math.round(blendedCpl * 100), currency)}
              </span>{' '}
              each
            </>
          )
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No recruitment campaigns yet"
          description={
            'Campaigns are ingested per mapped client. If this stays empty ' +
            'after a Windsor sync, the hiring ad account has lost its mapping.'
          }
          icon={<UserRoundSearch size={22} />}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-xs text-fg-muted">
                <th className="px-4 py-2 font-medium">Campaign</th>
                <th className="px-4 py-2 font-medium">Ran</th>
                <th className="px-4 py-2 text-right font-medium">Spend</th>
                <th className="px-4 py-2 text-right font-medium">Applicants</th>
                <th className="px-4 py-2 text-right font-medium">Cost each</th>
                <th className="px-4 py-2 text-right font-medium">Clicks</th>
                <th className="px-4 py-2 text-right font-medium">CTR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.campaign_name}-${row.first_day}`}
                  className="border-b border-line last:border-0 hover:bg-surface-hover"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-fg">{row.campaign_name}</div>
                    <div className="mt-0.5 text-xs text-fg-subtle">
                      {row.account_name}
                    </div>
                  </td>
                  <td className="numeric px-4 py-3 text-xs text-fg-subtle">
                    {row.first_day} → {row.last_day}
                  </td>
                  <td className="numeric px-4 py-3 text-right text-fg">
                    {formatMoney(Math.round(Number(row.spend ?? 0) * 100), currency)}
                  </td>
                  <td className="numeric px-4 py-3 text-right font-medium text-fg">
                    {formatCount(Number(row.leads ?? 0))}
                  </td>
                  <td className="numeric px-4 py-3 text-right text-fg-muted">
                    {row.cost_per_lead === null
                      ? '—'
                      : formatMoney(
                          Math.round(Number(row.cost_per_lead) * 100),
                          currency,
                        )}
                  </td>
                  <td className="numeric px-4 py-3 text-right text-fg-subtle">
                    {formatCount(Number(row.clicks ?? 0))}
                  </td>
                  <td className="numeric px-4 py-3 text-right text-fg-subtle">
                    {formatPercent(
                      Number(row.impressions ?? 0) === 0
                        ? null
                        : Number(row.clicks ?? 0) / Number(row.impressions),
                      2,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-xs text-fg-subtle">
        Kept out of every client figure on purpose. These leads are job
        applicants, not patients — blended into a practice&rsquo;s cost per lead
        they would make its marketing look roughly twice as effective as it is.
      </p>
    </>
  );
}
