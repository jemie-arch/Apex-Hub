import { CommissionBoard } from '@/components/callcenter/CommissionBoard';
import { PageHeader } from '@/components/ui/PageHeader';
import { getAgentCommission } from '@/lib/agent-commission';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Commission' };

/**
 * Commission, exactly as the pay dashboard calculates it.
 *
 * DELIBERATELY NO DATE PICKER. The pay dashboard pays on a rolling thirty days,
 * fixed — its A7 selector offers today, yesterday, 3, 7 and 30 days, and the
 * commission cell reads the 30-day count regardless of what else is on screen.
 * A picker here would produce a number that looks like pay and is not, which is
 * worse than not showing one. Its absence is the honest signal that this panel
 * does not follow the window the other sections use.
 */
export default async function CommissionPage() {
  const commission = await getAgentCommission();

  return (
    <>
      <PageHeader
        eyebrow="Call centre"
        title="Commission"
        description="Rolling 30 days, as the pay dashboard calculates it"
      />

      <CommissionBoard agents={commission} />

      <p className="mt-4 max-w-3xl text-xs text-warning">
        {/*
          Stated on the page rather than left for payroll to discover. The
          window and the pay cadence disagree, and the figure above is the one
          somebody would otherwise copy into a payment.
        */}
        This is a <strong>rolling 30 days</strong> and pay periods are 14.
        Paying these figures fortnightly would pay most bookings twice. The rate
        is also a cliff rather than a marginal tier — 95 bookings earn $8 each
        and 96 earn $10 each, so the 96th booking is worth $200.
      </p>
    </>
  );
}
