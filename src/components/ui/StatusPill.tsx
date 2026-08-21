import { cn } from '@/lib/cn';
import { humanise } from '@/lib/format';

/**
 * Semantic tone, deliberately not the accent. A won booking is green because
 * winning is good, not because green is on brand.
 */
export type Tone = 'positive' | 'warning' | 'negative' | 'neutral' | 'accent';

const TONES: Record<Tone, string> = {
  positive: 'bg-positive-subtle text-positive',
  warning: 'bg-warning-subtle text-warning',
  negative: 'bg-negative-subtle text-negative',
  neutral: 'bg-neutral-subtle text-fg-muted',
  accent: 'bg-accent-subtle text-accent',
};

export function StatusPill({
  value,
  tone = 'neutral',
  className,
}: {
  value: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {humanise(value)}
    </span>
  );
}

export function outcomeTone(outcome: string): Tone {
  switch (outcome) {
    case 'won':
      return 'positive';
    case 'lost':
    case 'unqualified':
      return 'negative';
    case 'quoted':
    case 'follow_up':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function appointmentStatusTone(status: string): Tone {
  switch (status) {
    case 'showed':
      return 'positive';
    case 'no_show':
    case 'cancelled':
      return 'negative';
    case 'rescheduled':
      return 'warning';
    case 'confirmed':
      return 'accent';
    default:
      return 'neutral';
  }
}

export function clientStatusTone(status: string): Tone {
  switch (status) {
    case 'active':
      return 'positive';
    case 'onboarding':
      return 'accent';
    case 'paused':
      return 'warning';
    case 'churned':
      return 'negative';
    default:
      return 'neutral';
  }
}
