/**
 * Slack alerts for sync failures.
 *
 * A broken sync currently writes a sync_runs row and waits for someone to open
 * /settings, which nobody does at 3am. This posts to #tech-team instead.
 *
 * An incoming webhook rather than a bot token on purpose: it grants exactly one
 * capability — post to one channel — so a leaked value cannot read anything.
 *
 * Every function here is best-effort. A failed alert must never fail the sync
 * that was trying to report; the sync_runs row is already the durable record.
 */
import { hubUrl } from '@/lib/app-url';
import { serverEnv } from '@/lib/env';

export interface SyncAlert {
  name: string;
  status: 'success' | 'partial' | 'error' | 'skipped';
  counts: { read: number; created: number; updated: number; skipped: number };
  errors: Array<{ message: string; context?: Record<string, unknown> }>;
  durationMs: number;
  triggeredBy: string;
}

function webhookUrl(): string | null {
  try {
    return serverEnv().SLACK_WEBHOOK_URL ?? null;
  } catch {
    // Environment invalid: not a reason to crash a sync's reporting path.
    return null;
  }
}

/** Where to send someone to look. Vercel provides VERCEL_URL automatically. */
function settingsUrl(): string | null {
  return hubUrl('/settings');
}

export function slackConfigured(): boolean {
  return webhookUrl() !== null;
}

/**
 * Posts when a sync ends badly. Successes are deliberately silent — an alert
 * channel that fires on every green run gets muted, and then the red ones are
 * missed too.
 */
export async function alertSyncFailure(alert: SyncAlert): Promise<void> {
  if (alert.status !== 'error' && alert.status !== 'partial') return;

  const url = webhookUrl();
  if (!url) return;

  const icon = alert.status === 'error' ? ':red_circle:' : ':large_orange_circle:';
  const counts =
    `read ${alert.counts.read} · created ${alert.counts.created} · ` +
    `updated ${alert.counts.updated} · skipped ${alert.counts.skipped}`;

  // Three is enough to diagnose; a wall of near-identical errors just buries
  // the channel. The full list is in sync_runs.errors.
  const shown = alert.errors.slice(0, 3);
  const remainder = alert.errors.length - shown.length;

  const lines = [
    `${icon} *${alert.name}* finished *${alert.status}* ` +
      `in ${Math.round(alert.durationMs / 1000)}s (${alert.triggeredBy})`,
    counts,
    ...shown.map((error) => `• ${error.message}`),
  ];

  if (remainder > 0) {
    lines.push(`• …and ${remainder} more, in sync_runs.errors`);
  }

  const link = settingsUrl();
  if (link) lines.push(`<${link}|Open settings>`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
    });

    if (!response.ok) {
      // Log, never throw: the caller is a sync that already has its own result
      // to report, and losing that to a Slack outage would be worse.
      console.error(
        `[slack] alert for ${alert.name} rejected: ${response.status}`,
      );
    }
  } catch (error) {
    console.error(
      `[slack] alert for ${alert.name} could not be sent:`,
      error instanceof Error ? error.message : error,
    );
  }
}
