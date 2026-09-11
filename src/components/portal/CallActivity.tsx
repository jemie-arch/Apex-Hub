import { Headphones, MessageSquare, CalendarPlus, Clock } from 'lucide-react';

import { KPICard } from '@/components/ui/KPICard';
import { formatCount } from '@/lib/format';

export interface PortalCallActivity {
  calls: number;
  conversations: number;
  appointments: number;
  talkSeconds: number;
}

/**
 * What the call centre did for this practice, in the practice's own portal.
 *
 * Four counters and nothing else. No cost, no agent names, no patient detail,
 * and deliberately no no-answer or hang-up counts — see the view's comment for
 * why. A practice cannot act on a no-answer rate and will read it as effort
 * when it is mostly a fact about how dental leads behave.
 */
export function CallActivity({
  activity,
  rangeLabel,
}: {
  activity: PortalCallActivity;
  rangeLabel: string;
}) {
  // Nothing to show is better than four zeros, which reads as a broken panel.
  if (activity.calls === 0) return null;

  const hours = activity.talkSeconds / 3600;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold text-fg">
        Our call team, {rangeLabel.toLowerCase()}
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Calls made"
          value={formatCount(activity.calls)}
          hint="on your behalf"
          icon={<Headphones size={16} />}
        />
        <KPICard
          label="Conversations"
          value={formatCount(activity.conversations)}
          hint="90 seconds or longer"
          icon={<MessageSquare size={16} />}
        />
        <KPICard
          label="Booked by our team"
          value={formatCount(activity.appointments)}
          hint={
            activity.conversations === 0
              ? 'from conversations held'
              : `from ${formatCount(activity.conversations)} conversations`
          }
          icon={<CalendarPlus size={16} />}
        />
        <KPICard
          label="Time on the phone"
          value={hours < 1 ? `${Math.round(activity.talkSeconds / 60)}m` : `${hours.toFixed(1)}h`}
          hint="talking to your leads"
          icon={<Clock size={16} />}
        />
      </div>
    </section>
  );
}
