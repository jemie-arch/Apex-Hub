/**
 * Reading a Google Sheet, with a service account.
 *
 * The Hub had no Google integration at all — no credentials, no client, nothing
 * in package.json — which is why the Client Fulfilment Tracker has only ever
 * arrived by hand. It was imported once, on 22 August 2026, and every surface
 * that reads it has been showing that snapshot since.
 *
 * Written as raw fetch rather than pulling in googleapis, because every other
 * integration here is raw fetch and one 200KB dependency for a single GET would
 * be the odd one out. The whole surface used is two endpoints: exchange a signed
 * assertion for a token, then read a range.
 *
 * ============================== ACCESS ==============================
 * A service account is a Google identity with its own email address. It cannot
 * see anything until a human shares the sheet with that address, exactly as
 * they would with a colleague — so this integration can never reach a document
 * nobody deliberately gave it.
 *
 * Read-only by scope. `spreadsheets.readonly` cannot write, so a bug here
 * cannot corrupt the tracker the call centre works in every day. If writing is
 * ever wanted it should be a separate, deliberate widening.
 * ====================================================================
 */
import { createSign } from 'node:crypto';

import { serverEnv } from '@/lib/env';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/**
 * Tokens last an hour; this asks for fifty minutes' worth of confidence.
 *
 * Cached in module scope rather than a table. A serverless instance lives for
 * minutes, so a database round trip to save one token exchange would cost more
 * than it saved — unlike the GoHighLevel tokens, which are shared across
 * processes and genuinely need storing.
 */
let cached: { token: string; expiresAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The private key as Google issues it, whatever the host did to the newlines.
 *
 * A PEM key pasted into an environment variable arrives with its line breaks
 * either intact or escaped as the two characters backslash-n, depending on the
 * platform and on whether somebody pasted it through a shell. Both are normal
 * and neither is an error worth failing a sync over.
 */
function privateKey(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

export interface GoogleCredentials {
  clientEmail: string;
  privateKey: string;
}

/**
 * The service account, or a loud error naming both halves.
 *
 * Same contract as the other integrations: missing credentials stop one sync
 * with an explanation, rather than failing a boot or — worse — reading as a
 * sheet that happens to be empty.
 */
export function googleCredentials(): GoogleCredentials {
  const env = serverEnv();

  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY must both be ' +
        'set before a Google Sheet can be read. Create a service account in ' +
        'Google Cloud, enable the Sheets API, then share the sheet with the ' +
        "service account's email address as a Viewer — it cannot see anything " +
        'until somebody shares it.',
    );
  }

  return {
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: privateKey(env.GOOGLE_SERVICE_ACCOUNT_KEY),
  };
}

/**
 * Exchange a signed assertion for an access token.
 *
 * This is the whole of Google's service-account flow: build a JWT claiming to
 * be the service account, sign it with the private key, and post it. There is
 * no refresh token and nothing to store — a new assertion is cheap and always
 * available, which is why this is simpler than the GoHighLevel or Hubstaff
 * flows despite looking more cryptographic.
 */
async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const { clientEmail, privateKey: key } = googleCredentials();

  const issuedAt = Math.floor(Date.now() / 1000);
  const claims = {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };

  const unsigned =
    `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.` +
    `${base64url(JSON.stringify(claims))}`;

  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = `${unsigned}.${base64url(signer.sign(key))}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    cache: 'no-store',
  });

  const text = await response.text();
  if (!response.ok) {
    /*
     * Carried through in full. Google's rejections are specific and each sends
     * you somewhere different: "invalid_grant" is usually a clock or a mangled
     * key, while a 403 naming the Sheets API means it was never enabled on the
     * project. "Could not authenticate" sends nobody anywhere.
     */
    throw new Error(`Google token exchange failed (${response.status}): ${text.slice(0, 400)}`);
  }

  const body = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new Error('Google returned no access_token, so the sheet cannot be read.');
  }

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + Math.min((body.expires_in ?? 3600) - 600, 3000) * 1000,
  };
  return cached.token;
}

/**
 * A range of cells, as rows of strings.
 *
 * FORMATTED_VALUE on purpose: the tracker is read by people, and a date that
 * reads "8/21/2026" on their screen should arrive here the same way rather than
 * as a Sheets serial number nobody can eyeball against the source.
 *
 * Google truncates trailing empty cells, so a row can come back shorter than
 * its header. Callers must index by header position rather than assuming a
 * fixed width — see the tracker sync, which pads before mapping.
 */
export async function readSheet(
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const token = await accessToken();

  const url =
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` +
    '?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Google refused to read ${spreadsheetId} (403). The usual cause is that ` +
          'the sheet has not been shared with the service account. Share it as a ' +
          `Viewer with ${googleCredentials().clientEmail}. Detail: ${text.slice(0, 300)}`,
      );
    }
    throw new Error(`Google Sheets read failed (${response.status}): ${text.slice(0, 400)}`);
  }

  const body = JSON.parse(text) as { values?: unknown };
  if (!Array.isArray(body.values)) return [];

  return body.values.map((row) =>
    Array.isArray(row) ? row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))) : [],
  );
}

/**
 * The titles of a spreadsheet's tabs, in order.
 *
 * Exists so a sync can find a tab by what it is called rather than by a name
 * hardcoded from somebody's description of it. The commission unit rate lives
 * in "cell B12 of the input values" — which is a tab title nobody has spelled
 * out, and A1 notation does not forgive a near miss: 'Input Values'!B12 and
 * 'Inputs'!B12 both come back as a flat 400 with no hint which part was wrong.
 *
 * Asking the spreadsheet what its tabs are called turns a guess into a lookup,
 * and lets the caller report the real titles when none of them match.
 */
export async function listSheetTitles(spreadsheetId: string): Promise<string[]> {
  const token = await accessToken();

  const response = await fetch(
    `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
  );

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `Google refused to open ${spreadsheetId} (403). Share it as a Viewer ` +
          `with ${googleCredentials().clientEmail}. Detail: ${text.slice(0, 300)}`,
      );
    }
    throw new Error(
      `Google Sheets metadata read failed (${response.status}): ${text.slice(0, 400)}`,
    );
  }

  const body = JSON.parse(text) as {
    sheets?: { properties?: { title?: string } }[];
  };

  return (body.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => typeof title === 'string');
}
