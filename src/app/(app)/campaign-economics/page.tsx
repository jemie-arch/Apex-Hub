import { TrendingUp } from 'lucide-react';

import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { tenant } from '@/config/tenant.config';
import { getCampaignEconomics } from '@/lib/campaign-economics';
import {
  formatCount,
  formatMoney,
  formatMultiple,
  formatPercent,
} from '@/lib/format';
import { dateBounds, resolveRange } from '@/lib/range';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Campaign economics' };

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Money spent against patients booked, per campaign.
 *
 * Spend from Windsor, bookings and treatment value from the practice stat
 * sheets, joined on the campaign id both carry. This is the first page in the
 * Hub that can answer "did that campaign pay for itself".
 *
 * Defaults to the last 30 days rather than this month, because campaign ids
 * only start appearing on bookings in August 2026 — 0% before July, 42.5% in
 * August, 84% in September. A longer window would dilute every rate with months
 * that could never have been attributed, and the note under the table says so
 * rather than leaving somebody to work it out.
 */
export default async function CampaignEconomicsPage({ searchParams }: PageProps) {
  const range = resolveRange({
    preset: single(searchParams['preset']) ?? 'last_30',
    from: single(searchParams['from']),
    to: single(searchParams['to']),
  });

  const { start, end } = dateBounds(range.from, range.to);
  const { rows, totals } = await getCampaignEconomics({ from: start, to: end });

  const currency = tenant.defaultCurrency;
  const booking = tenant.vocabulary.booking;

  const blended =
    totals.bookings === 0 || totals.spendCents === 0
      ? null
      : totals.spendCents / totals.bookings;

  return (
    <>
      <PageHeader
        eyebrow="Media buying"
        title="Campaign economics"
        description={
          blended === null ? (
            `Spend against ${booking.plural} booked · ${range.label}`
          ) : (
            <>
              {formatCount(totals.bookings)} {booking.plural} at{' '}
              <span className="numeric text-accent">
                {formatMoney(Math.round(blended), currency)}
              </span>{' '}
              each · {range.label}
            </>
          )
        }
        actions={<DateRangePicker />}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing joined in this window"
          description={
            'This page needs a campaign id on both sides: spend from Windsor and ' +
            'bookings from the practice stat sheets. Campaign ids only start ' +
            'appearing on bookings in August 2026, so a window before then has ' +
            'nothing to join.'
          }
          icon={<TrendingUp size={22} />}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[64rem] text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-xs text-fg-muted">
                  <th className="px-4 py-2 font-medium">Campaign</th>
                  <th className="px-4 py-2 text-right font-medium">Spend</th>
                  <th className="px-4 py-2 text-right font-medium">Booked</th>
                  <th className="px-4 py-2 text-right font-medium">
                    Cost / {booking.singular}
                  </th>
                  <th className="px-4 py-2 text-right font-medium">Showed</th>
                  <th className="px-4 py-2 text-right font-medium">Show %</th>
                  <th className="px-4 py-2 text-right font-medium">Started</th>
                  <th className="px-4 py-2 text-right font-medium">Value</th>
                  <th className="px-4 py-2 text-right font-medium">Return</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.campaignId}
                    className="border-b border-line last:border-0 align-top hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-fg">
                        {row.campaignName ?? row.campaignId}
                      </div>
                      <div className="mt-0.5 text-xs text-fg-subtle">
                        {row.clientName}
                      </div>
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg">
                      {formatMoney(row.spendCents, currency)}
                    </td>
                    <td className="numeric px-4 py-3 text-right font-medium text-fg">
                      {formatCount(row.bookings)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatMoney(row.costPerBookingCents, currency)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-subtle">
                      {formatCount(row.shows)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {formatPercent(row.showRate, 0)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-subtle">
                      {formatCount(row.converted)}
                    </td>
                    <td className="numeric px-4 py-3 text-right text-fg-muted">
                      {row.bookingsWithAValue === 0 ? (
                        <span className="text-fg-subtle">—</span>
                      ) : (
                        formatMoney(row.treatmentValueCents, currency)
                      )}
                    </td>
                    <td className="numeric px-4 py-3 text-right font-medium text-fg">
                      {formatMultiple(row.returnOnSpend)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 max-w-3xl text-xs text-fg-subtle">
            Spend comes from Windsor, {booking.plural} and treatment value from
            each practice&rsquo;s stat sheet, joined on the campaign id both
            carry. <strong className="text-fg-muted">Return is blank unless
            the campaign has both spend and a recorded treatment value</strong> —
            of{' '}
            <span className="numeric">{formatCount(totals.bookings)}</span>{' '}
            {booking.plural} here,{' '}
            <span className="numeric">
              {formatCount(totals.bookingsWithAValue)}
            </span>{' '}
            carry a value, and the rest are unrecorded rather than worth
            nothing.
          </p>

          <p className="mt-1 max-w-3xl text-xs text-warning">
            {/*
              Said here because a reader widening the window will otherwise
              watch every rate collapse and conclude the campaigns got worse.
            */}
            Campaign ids only began appearing on bookings in{' '}
            <strong>August 2026</strong> — none before July, 42.5% in August,
            84% in September. Looking further back does not show worse
            campaigns, it shows months that could never have been attributed.
          </p>
        </>
      )}
    </>
  );
}
