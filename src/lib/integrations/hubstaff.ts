/**
 * Hubstaff, read-only.
 *
 * One question: how many hours did each person track in a given window. That is
 * all the payout needs, and it is the only thing this module asks for.
 *
 * The token is a Personal Access Token held in the environment. It is never
 * written to the database, never logged, and never sent to the browser — the
 * same rule the GoHighLevel and Stripe modules follow.
 *
 * Dates rather than timestamps on the daily endpoint. Hubstaff's daily activity
 * report is keyed on the worker's own date, which is what a fortnight boundary
 * means to a person being paid; asking for a UTC instant would split somebody's
 * Friday evening across two periods depending on where they live.
 */
import { hubstaffCredentials } from '@/lib/env';

export interface HubstaffMember {
  id: string;
  name: string | null;
  email: string | null;
}

export interface HubstaffDailyTotal {
  userId: string;
  /** Seconds tracked, as Hubstaff reports it. */
  seconds: number;
}

interface RawOrganization {
  id?: unknown;
  name?: unknown;
}

interface RawUser {
  id?: unknown;
  name?: unknown;
  email?: unknown;
}

interface RawActivity {
  user_id?: unknown;
  tracked?: unknown;
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function seconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

async function get<T>(path: string): Promise<T> {
  const { token, apiBase } = hubstaffCredentials();

  const response = await fetch(`${apiBase}${path}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text();
    /*
     * The body is included because Hubstaff's 401 and 403 read very differently
     * — an expired token versus a token without the organisation scope — and
     * that distinction is the whole diagnosis. Sliced generously for the same
     * reason the GoHighLevel client stopped cutting at 300 characters: the
     * explanation tends to sit after the boilerplate.
     */
    throw new Error(
      `Hubstaff ${path} responded ${response.status}: ${body.slice(0, 1200)}`,
    );
  }

  return (await response.json()) as T;
}

/**
 * The organisation this token can see.
 *
 * Discovered rather than demanded. A token belongs to a person, and that person
 * usually has exactly one organisation — so making the id a required setting
 * would fail on a value nobody knew to look up. If there are several and none is
 * configured, this says so and names them rather than guessing.
 */
export async function resolveOrganizationId(): Promise<string> {
  const configured = hubstaffCredentials().organizationId;
  if (configured) return configured;

  const body = await get<{ organizations?: RawOrganization[] }>(
    '/organizations',
  );
  const orgs = (body.organizations ?? []).flatMap((row) => {
    const id = text(row.id);
    return id ? [{ id, name: text(row.name) ?? id }] : [];
  });

  if (orgs.length === 0) {
    throw new Error(
      'The Hubstaff token can see no organisations. Check the token belongs to ' +
        'a member of the Apex organisation.',
    );
  }
  if (orgs.length > 1) {
    throw new Error(
      'The Hubstaff token can see several organisations, so which one to read ' +
        'is ambiguous. Set HUBSTAFF_ORGANIZATION_ID to one of: ' +
        orgs.map((o) => `${o.name} (${o.id})`).join(', '),
    );
  }

  return orgs[0]!.id;
}

/** Everybody in the organisation, so tracked time can be attributed to a person. */
export async function listMembers(
  organizationId: string,
): Promise<HubstaffMember[]> {
  const body = await get<{ users?: RawUser[] }>(
    `/organizations/${encodeURIComponent(organizationId)}/members?include=users`,
  );

  return (body.users ?? []).flatMap((row) => {
    const id = text(row.id);
    return id
      ? [{ id, name: text(row.name), email: text(row.email)?.toLowerCase() ?? null }]
      : [];
  });
}

/**
 * Seconds tracked per person between two dates, inclusive.
 *
 * Summed across days here rather than returned per day, because a payout period
 * is the unit that matters and per-day detail would only be discarded upstream.
 *
 * Paginated on the documented cursor. Bounded so a pagination bug cannot spin
 * forever against a metered API — the same guard the Stripe client uses.
 */
export async function trackedSecondsByUser(
  organizationId: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  let cursor: string | null = null;

  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({
      'date[start]': from,
      'date[stop]': to,
    });
    if (cursor) query.set('page_start_id', cursor);

    const body = await get<{
      daily_activities?: RawActivity[];
      pagination?: { next_page_start_id?: unknown };
    }>(
      `/organizations/${encodeURIComponent(organizationId)}` +
        `/activities/daily?${query.toString()}`,
    );

    const rows = body.daily_activities ?? [];
    for (const row of rows) {
      const userId = text(row.user_id);
      if (!userId) continue;
      totals.set(userId, (totals.get(userId) ?? 0) + seconds(row.tracked));
    }

    const next = text(body.pagination?.next_page_start_id);
    if (!next || rows.length === 0) break;
    cursor = next;
  }

  return totals;
}
