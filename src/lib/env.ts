/**
 * Environment validation. Runs at import time so a bad deploy fails loudly at
 * boot instead of quietly producing a dashboard full of zeroes.
 *
 * Shapes are checked, not just presence: a Supabase URL that is not a URL and a
 * Meta API version that is not vNN.N are both caught here.
 */
import { z } from 'zod';

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('must be a full URL, e.g. https://abc.supabase.co'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(40, 'looks too short to be a Supabase anon key'),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(40, 'looks too short to be a service-role key'),

  // GoHighLevel. Tokens themselves live in oauth_tokens, per client.
  // Optional at boot: an app with no CRM connected yet should still start and
  // show its empty states. The syncs fail loudly instead — see ghlCredentials.
  GHL_CLIENT_ID: z.string().min(1).optional(),
  GHL_CLIENT_SECRET: z.string().min(1).optional(),
  GHL_REDIRECT_URI: z.string().url().optional(),
  GHL_API_BASE: z
    .string()
    .url()
    .default('https://services.leadconnectorhq.com'),
  GHL_API_VERSION: z.string().default('2021-07-28'),

  // Windsor.ai — the ad data source. One key covers every connected ad
  // account, so there is no per-account token to expire.
  WINDSOR_API_KEY: z.string().min(1).optional(),
  WINDSOR_API_BASE: z.string().url().default('https://connectors.windsor.ai'),

  /** Shared secret the cron routes require. Long enough not to be guessed. */
  CRON_SECRET: z.string().min(24, 'use at least 24 characters'),

  /**
   * Shared secret for machine-to-machine routes that hand out CRM tokens.
   * Separate from CRON_SECRET on purpose: this one is pasted into Make, so it
   * can be rotated without touching the cron schedule.
   */
  SERVICE_API_KEY: z.string().min(32, 'use at least 32 characters').optional(),

  /**
   * Slack incoming webhook for sync failure alerts. Optional: without it the
   * syncs still record everything to sync_runs, they just stay quiet.
   */
  SLACK_WEBHOOK_URL: z
    .string()
    .url()
    .startsWith('https://hooks.slack.com/', 'must be a Slack webhook URL')
    .optional(),

  /** Public origin, used to link back from an alert. Vercel sets VERCEL_URL. */
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

let cached: ServerEnv | null = null;

/**
 * Server-side environment. Throws on first call if anything is wrong.
 * Never call this from a component that renders in the browser — it reads
 * secrets that must not be bundled.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;

  if (typeof window !== 'undefined') {
    throw new Error(
      'serverEnv() was called in the browser. This module reads the ' +
        'service-role key and must stay on the server.',
    );
  }

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      'Invalid environment configuration:\n' +
        formatIssues(parsed.error) +
        '\n\nSee .env.example for the expected shape.',
    );
  }

  cached = parsed.data;
  return cached;
}

export interface GhlCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBase: string;
  apiVersion: string;
}

/**
 * GoHighLevel credentials, or a loud error naming exactly what is missing.
 * Called by the syncs and the OAuth routes — never at boot, so a deployment
 * without a CRM app configured still runs.
 */
export function ghlCredentials(): GhlCredentials {
  const env = serverEnv();
  const missing: string[] = [];

  if (!env.GHL_CLIENT_ID) missing.push('GHL_CLIENT_ID');
  if (!env.GHL_CLIENT_SECRET) missing.push('GHL_CLIENT_SECRET');
  if (!env.GHL_REDIRECT_URI) missing.push('GHL_REDIRECT_URI');

  if (missing.length > 0) {
    throw new Error(
      `GoHighLevel is not configured: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} not set. Add ` +
        'them to the environment, then retry.',
    );
  }

  return {
    clientId: env.GHL_CLIENT_ID!,
    clientSecret: env.GHL_CLIENT_SECRET!,
    redirectUri: env.GHL_REDIRECT_URI!,
    apiBase: env.GHL_API_BASE,
    apiVersion: env.GHL_API_VERSION,
  };
}

/** The machine-to-machine key, or a loud error naming what is missing. */
export function serviceApiKey(): string {
  const env = serverEnv();

  if (!env.SERVICE_API_KEY) {
    throw new Error(
      'SERVICE_API_KEY is not set, so machine-to-machine routes are disabled. ' +
        'Generate 32+ random characters and set it before pointing Make here.',
    );
  }

  return env.SERVICE_API_KEY;
}

export interface WindsorCredentials {
  apiKey: string;
  apiBase: string;
}

/**
 * Windsor credentials, or a loud error. Same contract as ghlCredentials:
 * absent configuration stops a sync, never a boot.
 */
export function windsorCredentials(): WindsorCredentials {
  const env = serverEnv();

  if (!env.WINDSOR_API_KEY) {
    throw new Error(
      'Windsor.ai is not configured: WINDSOR_API_KEY is not set. Copy the ' +
        'key from the Windsor dashboard, then retry.',
    );
  }

  return { apiKey: env.WINDSOR_API_KEY, apiBase: env.WINDSOR_API_BASE };
}

/** The two values the browser is allowed to see. */
export function publicEnv(): {
  supabaseUrl: string;
  supabaseAnonKey: string;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both ' +
        'be set at build time.',
    );
  }

  return { supabaseUrl: url, supabaseAnonKey: key };
}
