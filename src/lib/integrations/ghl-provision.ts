/**
 * Creating a GoHighLevel sub-account from a snapshot, and filling its custom
 * values.
 *
 * Separate from integrations/ghl.ts because everything here WRITES. That file is
 * read-only and safe to call speculatively; nothing in this one is.
 *
 * ============================== SCOPES ==============================
 * These calls need an agency-level credential with `locations.write` and
 * `locations/customValues.write`.
 *
 * The marketplace app does not have them. Tested rather than assumed: GET
 * /locations/ and GET /locations/{id} both answer 200, GET /snapshots/ answers
 * 401, and a real POST /locations/ answered
 *
 *     401 {"message":"The token is not authorized for this scope."}
 *
 * which is GoHighLevel saying the scope was never granted rather than the call
 * being wrong. Hence writeAuth() below and GHL_PRIVATE_TOKEN: a private
 * integration's scopes are chosen in the GoHighLevel UI, so this is a minute's
 * work instead of reinstalling the app across the agency.
 *
 * Every failure carries the HTTP status and body through to the caller for that
 * reason — "401 from POST /locations/" sends somebody to the right screen, and
 * "could not create sub-account" sends them nowhere.
 * ====================================================================
 */
import { serverEnv } from '@/lib/env';
import { getToken } from '@/lib/integrations/ghl';

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

/** Which credential a write went out under. Recorded so a failure is diagnosable. */
export type AuthKind = 'private_integration' | 'oauth_app' | 'location_token';

export interface WriteAuth {
  token: string;
  kind: AuthKind;
  /** The agency this token belongs to. Needed in the create-location body. */
  companyId: string | null;
}

/**
 * The credential to write with, preferring the private integration.
 *
 * Preferred rather than required: if GHL_PRIVATE_TOKEN is unset, or turns out not
 * to be accepted for these endpoints, provisioning still runs on the OAuth token
 * exactly as before. Adding the private token is a change that can only help, and
 * removing it is a rollback with no migration.
 */
export async function writeAuth(): Promise<WriteAuth> {
  const privateToken = serverEnv().GHL_PRIVATE_TOKEN;

  if (privateToken) {
    // A private integration carries no companyId of its own, so the agency id
    // still comes from the stored OAuth row — the only place we know it.
    let companyId: string | null = null;
    try {
      companyId = (await getToken(null)).companyId;
    } catch {
      // No OAuth row at all. createSubAccount says what is missing.
    }

    return { token: privateToken, kind: 'private_integration', companyId };
  }

  const oauth = await getToken(null);
  return { token: oauth.accessToken, kind: 'oauth_app', companyId: oauth.companyId };
}

export class GhlWriteError extends Error {
  readonly status: number;
  readonly body: string;
  readonly path: string;

  constructor(path: string, status: number, body: string) {
    super(`${status} from ${path}: ${body.slice(0, 300)}`);
    this.name = 'GhlWriteError';
    this.status = status;
    this.body = body;
    this.path = path;
  }

  /** Whether re-authorising the app would plausibly fix this. */
  get isScopeProblem(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function call<T>(
  token: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: VERSION,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  });

  const text = await response.text();
  if (!response.ok) throw new GhlWriteError(path, response.status, text);

  return (text === '' ? {} : JSON.parse(text)) as T;
}

export interface NewSubAccount {
  name: string;
  snapshotId: string;
  timezone?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  website?: string;
  phone?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Creates the sub-account and returns its id.
 *
 * The snapshot is applied by GoHighLevel asynchronously — the response comes
 * back before the snapshot has finished loading, which is why the caller must
 * not assume the custom values exist the instant this resolves.
 */
export async function createSubAccount(
  input: NewSubAccount,
): Promise<{ locationId: string; raw: unknown; auth: AuthKind }> {
  const { token: accessToken, kind, companyId } = await writeAuth();

  if (!companyId) {
    throw new Error(
      'The agency token has no companyId recorded, and creating a sub-account ' +
        'needs one. Reconnect the GoHighLevel app in settings.',
    );
  }

  const payload: Record<string, unknown> = {
    name: input.name,
    companyId,
    snapshotId: input.snapshotId,
  };

  // Only send what we actually have. GoHighLevel rejects some fields when they
  // are present and empty, which reads as a validation error about a field
  // nobody filled in.
  const optional: Array<[string, string | undefined]> = [
    ['timezone', input.timezone],
    ['address', input.address],
    ['city', input.city],
    ['state', input.state],
    ['postalCode', input.postalCode],
    ['country', input.country],
    ['website', input.website],
    ['phone', input.phone],
    ['email', input.email],
    ['firstName', input.firstName],
    ['lastName', input.lastName],
  ];
  for (const [key, value] of optional) {
    if (value !== undefined && value.trim() !== '') payload[key] = value.trim();
  }

  const created = await call<{ id?: string; location?: { id?: string } }>(
    accessToken,
    'POST',
    '/locations/',
    payload,
  );

  const locationId = created.id ?? created.location?.id;
  if (!locationId) {
    throw new Error(
      'GoHighLevel accepted the sub-account but returned no id, so nothing ' +
        'further can be configured. Check the agency for a half-made account ' +
        'before retrying, or a duplicate will be created.',
    );
  }

  return { locationId, raw: created, auth: kind };
}

export interface CustomValue {
  id: string;
  name: string;
  value: string | null;
}

/**
 * The credential for a location-scoped endpoint, from the token manager.
 *
 * /locations/{id}/customValues is location scoped, and an agency credential is
 * not necessarily accepted there — the likelier reading of a 401 that survives
 * granting every agency scope. So this asks getToken() for a token belonging to
 * that sub-account.
 *
 * Through the token manager rather than minting one inline, which is what this
 * did first. The manager stores the token with its expiry, reuses it while it is
 * valid, and takes a lease before refreshing — GoHighLevel invalidates a refresh
 * token the moment it is used, so two callers refreshing at once leaves one
 * holding a dead token. Minting a throwaway on every call sidesteps all of that
 * and quietly burns a request each time.
 *
 * Needs a clients row, which is why provisioning registers the sub-account
 * before configuring it. Falls back to the agency credential when there is no
 * row, so nothing here can fail merely for want of one.
 */
async function locationAuth(clientId: string | null): Promise<WriteAuth> {
  if (clientId === null) return writeAuth();

  try {
    const token = await getToken(clientId);
    return { token: token.accessToken, kind: 'location_token', companyId: null };
  } catch {
    return writeAuth();
  }
}

export async function listCustomValues(
  clientId: string | null,
  locationId: string,
): Promise<CustomValue[]> {
  const { token: accessToken } = await locationAuth(clientId);

  const payload = await call<{ customValues?: unknown[] }>(
    accessToken,
    'GET',
    `/locations/${locationId}/customValues`,
  );

  const rows = Array.isArray(payload.customValues) ? payload.customValues : [];

  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const record = row as Record<string, unknown>;
    const id = typeof record['id'] === 'string' ? record['id'] : null;
    const name = typeof record['name'] === 'string' ? record['name'] : null;
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        value: typeof record['value'] === 'string' ? record['value'] : null,
      },
    ];
  });
}

export interface CustomValueResult {
  /** Which credential the values went out under, which is not always the one
   * that created the account — custom values are location scoped. */
  auth: AuthKind;
  written: string[];
  /** Asked for but no custom value of that name exists in the sub-account. */
  missing: string[];
  /** Tried and refused, with the reason. */
  failed: Array<{ name: string; reason: string }>;
}

/**
 * Writes values onto existing custom values, matched by name.
 *
 * Updates only; it never creates. A snapshot defines these, so a name that is
 * not there is a mismatch between this mapping and the snapshot — and creating
 * it would produce a second field with the same purpose that nothing reads,
 * which is worse than the value being absent and reported.
 *
 * Matching is case- and space-insensitive because the snapshot's own naming is
 * not consistent: it contains both "Landmark1" and "Landmark 2".
 */
export async function setCustomValues(
  clientId: string | null,
  locationId: string,
  values: Record<string, string>,
): Promise<CustomValueResult> {
  const { token: accessToken, kind } = await locationAuth(clientId);
  const existing = await listCustomValues(clientId, locationId);

  const key = (name: string) => name.toLowerCase().replace(/\s+/g, '');
  const byKey = new Map(existing.map((row) => [key(row.name), row]));

  const result: CustomValueResult = { auth: kind, written: [], missing: [], failed: [] };

  for (const [name, value] of Object.entries(values)) {
    if (value.trim() === '') continue;

    const target = byKey.get(key(name));
    if (!target) {
      result.missing.push(name);
      continue;
    }

    try {
      await call(
        accessToken,
        'PUT',
        `/locations/${locationId}/customValues/${target.id}`,
        { name: target.name, value },
      );
      result.written.push(target.name);
    } catch (error) {
      result.failed.push({
        name: target.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
