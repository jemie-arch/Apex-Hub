/**
 * Onboarding and launch calls, from the ADM Client Onboarding sub-account into
 * client_groups.
 *
 * These two dates are the columns a CSM chases on the Client Onboarding list,
 * and they are booked in a sub-account of Apex's own rather than in the
 * practice's — so no other sync reaches them. The list showed an em dash for
 * both until this ran.
 *
 * Two matching problems, both handled by refusing rather than guessing.
 *
 * WHICH CALL IS IT. Decided by calendar name, not by title: a title is typed by
 * whoever booked it and drifts, a calendar is configured once. Calendars that
 * match neither pattern are counted and named in the run notes, because a
 * renamed calendar would otherwise look like a quiet fortnight.
 *
 * WHICH PRACTICE IS IT. By the booked contact's email, then phone, then name,
 * against what the practice told us on its own forms and its group record. An
 * appointment that matches nothing is left unattached: writing an onboarding
 * call against the wrong practice would have a CSM ring the wrong people.
 */
import { getContact, listAppointments, listCalendars } from '@/lib/integrations/ghl';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/** Apex's own onboarding sub-account, where both calls are booked. */
const ONBOARDING_LOCATION_ID = 'GadFUvfBRQPoUbKD3GBr';

/** How far back and forward to read. Launch calls are booked weeks ahead. */
const DAYS_BACK = 180;
const DAYS_FORWARD = 120;

/** Contact lookups per run. Each is an API call, so it is bounded. */
const CONTACT_BUDGET = 300;

type CallKind = 'onboarding' | 'launch';

/**
 * Which of the two a calendar holds, by name.
 *
 * Launch is tested first: "launch call" would otherwise match the onboarding
 * pattern in a calendar named "Onboarding — Launch".
 */
export function classifyCalendar(name: string | null): CallKind | null {
  const text = (name ?? '').toLowerCase();
  if (text === '') return null;

  if (/\blaunch\b|\bgo[- ]?live\b/.test(text)) return 'launch';
  if (/\bonboard/.test(text) || /\bkick[- ]?off\b/.test(text)) return 'onboarding';

  return null;
}

/** Digits only, so +1 (555) 010-9999 and 5550109999 compare equal. */
function digits(value: string | null | undefined): string | null {
  const only = (value ?? '').replace(/\D/g, '');
  // Ten is a North American number without the country code; shorter is an
  // extension or a typo, and matching on four digits would attach a call to
  // whichever practice happened to share them.
  if (only.length < 10) return null;
  return only.slice(-10);
}

function normaliseName(value: string | null | undefined): string | null {
  const text = (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return text.length < 4 ? null : text;
}

export async function syncOnboardingCalls(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  const location = await db
    .from('clients')
    .select('id, name')
    .eq('crm_location_id', ONBOARDING_LOCATION_ID)
    .maybeSingle();

  if (location.error) throw location.error;
  if (!location.data) {
    ctx.recordError(
      'The ADM Client Onboarding sub-account is not in clients, so no token ' +
        'can be minted for it. Run crm-clients first.',
      { locationId: ONBOARDING_LOCATION_ID },
    );
    return;
  }

  const calendars = await listCalendars(location.data.id, ONBOARDING_LOCATION_ID);

  const kindOf = new Map<string, CallKind>();
  const unmatched: string[] = [];
  for (const calendar of calendars) {
    const kind = classifyCalendar(calendar.name);
    if (kind) kindOf.set(calendar.id, kind);
    else unmatched.push(calendar.name ?? calendar.id);
  }

  ctx.note('calendars_seen', calendars.length);
  ctx.note('calendars_matched', kindOf.size);
  if (unmatched.length > 0) {
    // Named, not just counted: if the onboarding calendar gets renamed this is
    // the only thing that will say so.
    ctx.note('calendars_unrecognised', unmatched);
  }

  if (kindOf.size === 0) {
    /*
     * Rewritten to be actionable by whoever can actually fix it.
     *
     * The old wording — "check the names against classifyCalendar()" — names an
     * internal function, so the only person who could act on it was a developer
     * reading this file. Meanwhile it fired every night, because the onboarding
     * sub-account holds one personal calendar and nothing else. An alert that
     * recurs forever and tells its reader to inspect source code is one nobody
     * will action, and this one has not been actioned.
     *
     * Both real outcomes are stated, because "no calendar matches" has two very
     * different causes and the fix differs completely.
     */
    ctx.recordError(
      'The onboarding sub-account has no calendar that looks like an ' +
        'onboarding or launch call, so this sync can never find anything. ' +
        'Either onboarding and launch calls are booked somewhere this cannot ' +
        'see — in which case point it at the right sub-account — or they are ' +
        'not booked in GoHighLevel at all, in which case retire this sync ' +
        'rather than leave it alerting. Calendars actually present are listed ' +
        'below.',
      { calendars_present: calendars.map((calendar) => calendar.name) },
    );
    return;
  }

  const now = new Date();
  const from = new Date(now.getTime() - DAYS_BACK * 86_400_000);
  const to = new Date(now.getTime() + DAYS_FORWARD * 86_400_000);

  const appointments = await listAppointments(
    location.data.id,
    ONBOARDING_LOCATION_ID,
    from,
    to,
  );

  const relevant = appointments.filter(
    (appointment) =>
      appointment.calendarId !== null && kindOf.has(appointment.calendarId),
  );

  ctx.note('appointments_in_window', appointments.length);
  ctx.note('appointments_on_matched_calendars', relevant.length);

  if (relevant.length === 0) {
    ctx.log('No onboarding or launch calls booked in the window.');
    return;
  }

  // Everything we know that could identify a practice, built once.
  const [groups, submissions] = await Promise.all([
    db
      .from('client_groups')
      .select('id, name, contact_email, contact_phone, contact_name'),
    db
      .from('form_submissions')
      .select('client_group_id, contact_email, contact_phone, person_name')
      .eq('is_test', false)
      .not('client_group_id', 'is', null),
  ]);

  if (groups.error) throw groups.error;
  if (submissions.error) throw submissions.error;

  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  const byName = new Map<string, string>();

  function remember(map: Map<string, string>, key: string | null, groupId: string) {
    if (key === null) return;
    const existing = map.get(key);
    // A detail shared by two practices identifies neither, so it is poisoned
    // rather than resolved to whichever was seen first.
    if (existing !== undefined && existing !== groupId) {
      map.set(key, '');
      return;
    }
    map.set(key, groupId);
  }

  for (const group of groups.data ?? []) {
    remember(byEmail, group.contact_email?.toLowerCase() ?? null, group.id);
    remember(byPhone, digits(group.contact_phone), group.id);
    remember(byName, normaliseName(group.contact_name), group.id);
  }

  for (const row of submissions.data ?? []) {
    if (!row.client_group_id) continue;
    remember(byEmail, row.contact_email?.toLowerCase() ?? null, row.client_group_id);
    remember(byPhone, digits(row.contact_phone), row.client_group_id);
    remember(byName, normaliseName(row.person_name), row.client_group_id);
  }

  const contactCache = new Map<
    string,
    { email: string | null; phone: string | null; name: string | null } | null
  >();

  let lookups = 0;
  const resolved = new Map<string, { onboarding?: string; launch?: string }>();
  let matched = 0;
  let unresolved = 0;
  let ambiguous = 0;
  let overBudget = 0;

  for (const appointment of relevant) {
    const kind = kindOf.get(appointment.calendarId!)!;
    if (!appointment.contactId) {
      unresolved += 1;
      continue;
    }

    if (!contactCache.has(appointment.contactId)) {
      if (lookups >= CONTACT_BUDGET) {
        overBudget += 1;
        continue;
      }
      lookups += 1;

      const contact = await getContact(location.data.id, appointment.contactId);
      contactCache.set(
        appointment.contactId,
        contact
          ? {
              email: contact.email?.toLowerCase() ?? null,
              phone: digits(contact.phone),
              name: normaliseName(contact.name),
            }
          : null,
      );
    }

    const contact = contactCache.get(appointment.contactId) ?? null;
    if (!contact) {
      unresolved += 1;
      continue;
    }

    const hit =
      (contact.email ? byEmail.get(contact.email) : undefined) ??
      (contact.phone ? byPhone.get(contact.phone) : undefined) ??
      (contact.name ? byName.get(contact.name) : undefined);

    if (hit === '') {
      ambiguous += 1;
      continue;
    }
    if (!hit) {
      unresolved += 1;
      continue;
    }

    matched += 1;
    const entry = resolved.get(hit) ?? {};

    // The most recent booking of each kind wins: a rescheduled call leaves the
    // old one on the calendar, and the date a CSM needs is the one coming up.
    const current = entry[kind];
    if (current === undefined || appointment.startsAt > current) {
      entry[kind] = appointment.startsAt;
    }
    resolved.set(hit, entry);
  }

  ctx.note('matched_to_a_practice', matched);
  ctx.note('no_practice_matched', unresolved);
  ctx.note('ambiguous_contact_details', ambiguous);
  if (overBudget > 0) {
    ctx.note('skipped_over_contact_budget', overBudget);
    ctx.recordError(
      `${overBudget} appointments were skipped: the ${CONTACT_BUDGET}-contact ` +
        'lookup budget ran out. Run again to pick up the rest.',
    );
  }

  for (const [groupId, dates] of resolved) {
    if (!dates.onboarding && !dates.launch) continue;

    const patch: {
      onboarding_call_at?: string;
      launch_call_at?: string;
    } = {};
    if (dates.onboarding) patch.onboarding_call_at = dates.onboarding;
    if (dates.launch) patch.launch_call_at = dates.launch;

    const written = await db
      .from('client_groups')
      .update(patch)
      .eq('id', groupId);

    if (written.error) {
      ctx.recordError(`Could not write call dates: ${written.error.message}`, {
        groupId,
      });
      continue;
    }

    ctx.counts.updated += 1;
  }

  ctx.log(
    `${matched} of ${relevant.length} calls matched a practice; ` +
      `${ctx.counts.updated} practices updated.`,
  );
}
