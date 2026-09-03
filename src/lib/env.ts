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

  /**
   * An agency-level Private Integration token, used only for provisioning.
   *
   * Optional and additive. When set, creating a sub-account and writing its
   * custom values use this instead of the marketplace app's OAuth token; every
   * read sync carries on using OAuth, because those rely on per-location tokens
   * minted from the agency install and work today.
   *
   * Worth having for three reasons. Its scopes are chosen in the GoHighLevel UI,
   * so granting locations.write takes a minute rather than a reinstall across
   * the agency. It does not expire, so provisioning skips the refresh-token
   * lease in integrations/ghl.ts entirely — GoHighLevel invalidates a refresh
   * token the moment it is used, and two callers refreshing at once is a real
   * failure mode there. And it can hold only the two scopes provisioning needs,
   * rather than sharing the scope set every sync depends on.
   *
   * It is a long-lived static secret with no rotation, so it belongs in the
   * environment and nowhere else: never in the database beside the OAuth rows,
   * never logged, never returned to a browser.
   */
  GHL_PRIVATE_TOKEN: z.string().min(1).optional(),

  // Windsor.ai — the ad data source. One key covers every connected ad
  // account, so there is no per-account token to expire.
  WINDSOR_API_KEY: z.string().min(1).optional(),

  /*
   * Hubstaff, for payout hours. A Personal Access Token from Settings ->
   * Personal Access Tokens, held only here — never in the database, never in a
   * log, never in the browser. Optional so its absence stops the payout sync
   * rather than the whole app.
   */
  /*
   * Google, for reading the Client Fulfilment Tracker.
   *
   * Two variables rather than the whole service-account JSON blob: the blob is
   * awkward to paste into a hosting panel and carries fields nothing here uses.
   * The key arrives with its newlines either intact or escaped depending on the
   * platform, and google-sheets normalises both.
   *
   * Optional like every other integration credential. Without them the tracker
   * sync stops with an explanation and nothing else is affected -- it is not
   * registered in the nightly cycle until they exist, for the same reason
   * scenario-audit and payout-hours are not.
   *
   * The service account can see nothing until somebody shares the sheet with
   * its email address, so setting these grants no access on its own.
   */
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().min(1).optional(),
  /** The Client Fulfilment Tracker's spreadsheet id, from its URL. */
  FULFILMENT_TRACKER_SHEET_ID: z.string().min(1).optional(),

  HUBSTAFF_TOKEN: z.string().min(1).optional(),
  HUBSTAFF_API_BASE: z.string().url().default('https://api.hubstaff.com/v2'),
  /** The organisation whose members and time are read. */
  HUBSTAFF_ORGANIZATION_ID: z.string().min(1).optional(),
  /**
   * Make.com API token, read scopes only. Optional for the same reason
   * HUBSTAFF_TOKEN is: without it the scenario audit cannot run, and that must
   * stop one sync rather than a boot.
   *
   * The zone matters. Make shards its API by zone, and a token issued in one
   * zone is rejected by another with a 401 that reads exactly like a bad key.
   * Apex is on us2, which is why that is the default.
   */
  MAKE_TOKEN: z.string().min(1).optional(),
  MAKE_API_BASE: z.string().url().default('https://us2.make.com/api/v2'),
  /**
   * The Make data store that holds clinic-to-sheet routing. Optional: without it
   * the export sync stops, which is the correct failure — publishing routing to
   * the wrong store would point every clinic at the wrong sheet at once.
   */
  MAKE_ROUTING_DATA_STORE_ID: z.string().min(1).optional(),
  /** The team whose scenarios are audited. Discovered when not set. */
  MAKE_TEAM_ID: z.string().min(1).optional(),
  WINDSOR_API_BASE: z.string().url().default('https://connectors.windsor.ai'),

  /**
   * Stripe restricted key, read scopes only — this is how the billing page
   * learns which charges succeeded and which were declined.
   *
   * The `rk_` prefix is enforced rather than suggested. A secret key (sk_)
   * would work identically for reads while also granting the ability to charge
   * cards and issue refunds, and nothing in this app needs that. Pasting one in
   * fails the deploy instead of quietly widening the blast radius.
   */
  STRIPE_RESTRICTED_KEY: z
    .string()
    .startsWith(
      'rk_',
      'must be a Stripe restricted key (rk_…). Secret keys (sk_…) grant write ' +
        'access and are rejected on purpose',
    )
    .optional(),

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

  /**
   * The @apex ticket bot. Separate credentials from SLACK_WEBHOOK_URL above,
   * which is an incoming webhook that can only post alerts to #tech-team.
   *
   * SLACK_SIGNING_SECRET is what authenticates inbound events. It cannot be
   * optional-in-effect the way an API key can: /api/slack/events has a public
   * URL — Slack decides what it sends and cannot be told to add an
   * Authorization header — so the signature is the only thing standing between
   * the ticket table and anyone who finds the URL. The route answers 503 when
   * this is unset rather than accepting unsigned requests.
   *
   * The `xoxb-` prefix on the token is enforced for the same reason the Stripe
   * key must be `rk_`. A user token (`xoxp-`) would work for every call the bot
   * makes while also carrying the full reach of whoever installed it — every
   * private channel and DM they can see. Pasting one in fails the deploy
   * instead of quietly widening what a leaked value is worth.
   */
  SLACK_SIGNING_SECRET: z.string().min(1).optional(),
  SLACK_BOT_TOKEN: z
    .string()
    .startsWith(
      'xoxb-',
      'must be a bot token (xoxb-…). User tokens (xoxp-…) carry the installing ' +
        "person's whole reach and are rejected on purpose",
    )
    .optional(),

  /**
   * Who a Slack-raised ticket is assigned to. Ally by default, because that is
   * who runs tech support.
   *
   * An email rather than a user id: ids are opaque, and somebody rotating this
   * to a different person on a Friday afternoon should not have to run a query
   * to find the value. Matched case-insensitively against user_profiles.
   */
  TECH_SUPPORT_ASSIGNEE_EMAIL: z
    .string()
    .email()
    .default('ally@apexdentalmarketing.net'),

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

  // Empty strings are treated as absent.
  //
  // A hosting platform stores a variable you left blank as "", not as missing.
  // Zod sees a present value and runs the validator on it, so every optional
  // field declared .url() or .min(1) fails and this throws — taking down every
  // server-rendered page over a variable nobody needed yet.
  const present = Object.fromEntries(
    Object.entries(process.env).filter(
      ([, value]) => value !== undefined && value !== '',
    ),
  );

  const parsed = serverSchema.safeParse(present);
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

/**
 * An integration has no credentials, as opposed to broken ones.
 *
 * Exists so the nightly cycle can tell "nobody has set this up yet" apart from
 * "this is failing". The difference matters more than it looks. Leaving an
 * unconfigured sync out of the cycle means a manual step somebody has to
 * remember months later; leaving it in means the cycle reports a failure every
 * night, which is how a real failure stops being noticed. Neither is
 * acceptable, so the runner treats this as a skip and the sync joins the cycle
 * the moment its credentials exist, with no code change.
 */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotConfiguredError';
  }
}

export interface HubstaffCredentials {
  /**
   * Null once the seed has been removed from the environment, which is the
   * expected steady state — the live token is in oauth_tokens.
   */
  token: string | null;
  apiBase: string;
  organizationId: string | null;
}

/**
 * The Hubstaff token, or a loud error. Same contract as the others: missing
 * configuration stops the payout sync, never a boot.
 *
 * The organisation id is returned rather than demanded, because the API can
 * list organisations for a token — so the sync can discover it and say which
 * one it picked instead of failing on a value nobody knew to set.
 */
export function hubstaffCredentials(): HubstaffCredentials {
  const env = serverEnv();

  /*
   * Deliberately does NOT throw on a missing token, unlike its siblings.
   *
   * Hubstaff rotates its refresh token on every exchange, so the live
   * credential lives in oauth_tokens and HUBSTAFF_TOKEN is only a seed for the
   * very first run. Throwing here would make the integration unusable in its
   * normal steady state — token in the database, seed long since removed from
   * the environment — which is exactly backwards. The client decides whether it
   * has a credential, because only the client can see the database.
   */
  return {
    token: env.HUBSTAFF_TOKEN ?? null,
    apiBase: env.HUBSTAFF_API_BASE,
    organizationId: env.HUBSTAFF_ORGANIZATION_ID ?? null,
  };
}

export interface MakeCredentials {
  token: string;
  apiBase: string;
  teamId: string | null;
}

/**
 * The Make API token, or a loud error naming the one place to get it.
 *
 * Read-only by intent. The scenario audit reads blueprints and never writes, so
 * a token carrying write scopes buys nothing and risks a great deal — a mistake
 * on this path would be editing live client automations.
 */
export function makeCredentials(): MakeCredentials {
  const env = serverEnv();

  if (!env.MAKE_TOKEN) {
    throw new Error(
      'Make is not configured: MAKE_TOKEN is not set, so the scenario audit ' +
        'cannot read any blueprints. Create a token in Make under Profile then ' +
        'API access with the scenarios:read scope, add it to the environment, ' +
        'and retry. Nothing else in the app needs it.',
    );
  }

  return {
    token: env.MAKE_TOKEN,
    apiBase: env.MAKE_API_BASE,
    teamId: env.MAKE_TEAM_ID ?? null,
  };
}

/**
 * The routing data store id, or a loud error.
 *
 * Separate from makeCredentials because reading scenarios and writing routing
 * are different privileges with different consequences, and the audit must keep
 * working on an environment where routing is not configured yet.
 */
export function makeRoutingStoreId(): string {
  const env = serverEnv();

  if (!env.MAKE_ROUTING_DATA_STORE_ID) {
    throw new Error(
      'Clinic routing is not configured: MAKE_ROUTING_DATA_STORE_ID is not ' +
        'set, so there is no store to publish to. Find the data store id in ' +
        'Make under Data stores, add it to the environment, and retry.',
    );
  }

  return env.MAKE_ROUTING_DATA_STORE_ID;
}

export interface StripeCredentials {
  apiKey: string;
}

/**
 * The Stripe restricted key, or a loud error. Same contract as the others:
 * missing configuration stops the billing sync, never a boot.
 */
export function stripeCredentials(): StripeCredentials {
  const env = serverEnv();

  if (!env.STRIPE_RESTRICTED_KEY) {
    throw new Error(
      'Stripe is not configured: STRIPE_RESTRICTED_KEY is not set, so charge ' +
        'outcomes cannot be read. Create a restricted key in Stripe with read ' +
        'access to payment intents, charges, invoices and customers, then retry.',
    );
  }

  return { apiKey: env.STRIPE_RESTRICTED_KEY };
}

/**
 * The Slack signing secret, or a loud error.
 *
 * Called by /api/slack/events before anything else, so an unconfigured
 * deployment answers 503 — "not set up" — rather than 401, which reads as a
 * wrong secret and sends somebody hunting the wrong problem. The same
 * distinction the service-key routes draw.
 */
export function slackSigningSecret(): string {
  const env = serverEnv();

  if (!env.SLACK_SIGNING_SECRET) {
    throw new Error(
      'The Slack ticket bot is not configured: SLACK_SIGNING_SECRET is not ' +
        'set, so inbound events cannot be verified and are all rejected. Copy ' +
        'it from the Slack app under Basic Information then App Credentials.',
    );
  }

  return env.SLACK_SIGNING_SECRET;
}

/**
 * The bot token, or a loud error.
 *
 * Separate from the signing secret because they fail differently and are worth
 * failing differently. Without the signing secret no ticket can be filed at
 * all. Without the token tickets are filed perfectly well and the bot simply
 * cannot say so in Slack — which is a degraded bot, not a broken one, and
 * lib/slack/api treats it as one.
 */
export function slackBotToken(): string {
  const env = serverEnv();

  if (!env.SLACK_BOT_TOKEN) {
    throw new Error(
      'SLACK_BOT_TOKEN is not set, so the bot cannot reply in Slack. Tickets ' +
        'are still filed. Copy the Bot User OAuth Token (xoxb-…) from the ' +
        'Slack app under OAuth & Permissions.',
    );
  }

  return env.SLACK_BOT_TOKEN;
}

/** The two values the browser is allowed to see. */
export function publicEnv(): {
  supabaseUrl: string;
  supabaseAnonKey: string;
} {
  // Trimmed because a value pasted into a dashboard field can carry a stray
  // newline, which survives into the bundle and produces a malformed URL.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both ' +
        'be set at build time.',
    );
  }

  return { supabaseUrl: url, supabaseAnonKey: key };
}
