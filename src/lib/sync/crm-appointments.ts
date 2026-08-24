/**
 * GoHighLevel calendar events -> appointments (the b2c funnel).
 *
 * The rules that matter here:
 *   * idempotent by crm_appointment_id — re-running never duplicates
 *   * a reschedule UPDATES the existing row, recording where it moved from,
 *     rather than inserting a second booking that would double-count
 *   * outcome, job value and notes belong to whoever typed them. The CRM does
 *     not know them and must never blank them
 *   * everything is stored UTC
 */
import type { AppointmentRow, AppointmentStatus } from '@/types/database';

import {
  getContact,
  listAppointments,
  listCalendars,
  type GhlAppointment,
} from '@/lib/integrations/ghl';
import { chunk, ID_LOOKUP_BATCH } from '@/lib/chunk';
import { authoritative, humanOwned } from '@/lib/sync/merge';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/** How far back and forward to look. Bounded so this cannot grow unbounded. */
const LOOKBACK_DAYS = 45;
const LOOKAHEAD_DAYS = 90;

/**
 * Only the practice's consultation calendar, named "<Location> Booking
 * Calendar" by the snapshot that provisions every sub-account.
 *
 * This sync used to read every calendar a location had, and 1,026 of the 2,411
 * appointments in the table — 42.6% — came from a second calendar rather than
 * the booking one. Those are hygiene slots, recalls and PatientSync mirror
 * calendars: real appointments, but not the new-patient consultations this
 * funnel is about, and counting them inflated every show rate and every cost per
 * booking on the dashboard.
 *
 * Matched on the suffix rather than the whole template, because the location
 * name in GoHighLevel does not always equal the name we hold, and a mismatch
 * there would silently return no appointments at all.
 */
export function isConsultationCalendar(calendar: { name: string | null }): boolean {
  return /\bbooking calendar\s*$/i.test((calendar.name ?? '').trim());
}

/**
 * Contact lookups are one request each, so they are capped per run. New
 * bookings are enriched first; the rest catch up on the next pass.
 */
const MAX_CONTACT_LOOKUPS = 200;

interface MappedStatus {
  status: AppointmentStatus;
  /** null when the CRM has not said either way. Never guess false. */
  showed: boolean | null;
}

export function mapStatus(event: GhlAppointment): MappedStatus {
  const raw = (event.appointmentStatus ?? event.status ?? '').toLowerCase();

  switch (raw) {
    case 'showed':
      return { status: 'showed', showed: true };
    case 'noshow':
    case 'no-show':
    case 'no_show':
      return { status: 'no_show', showed: false };
    case 'confirmed':
      return { status: 'confirmed', showed: null };
    case 'cancelled':
    case 'canceled':
    case 'invalid':
      return { status: 'cancelled', showed: null };
    default:
      return { status: 'scheduled', showed: null };
  }
}

export async function syncCrmAppointments(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  /*
   * Active sub-accounts whose business has not churned, and which are practices.
   *
   * Resolved as two queries and filtered in memory rather than an embedded join,
   * so the shape stays obvious and the types stay exact.
   *
   * Internal accounts are skipped because they can never hold a consultation and
   * were making the one alert this sync raises useless. "Ten practices have no
   * booking calendar" turned out to mean two practices and eight things that are
   * not practices at all — Apex's own Pay Per Show System, a vendor demo, two
   * accounts called PNW Survival Games, a client's recruitment account. An alert
   * that is mostly noise is an alert nobody reads.
   */
  const [clientRows, skipGroups] = await Promise.all([
    db
      .from('clients')
      .select('id, name, group_id, crm_location_id, timezone')
      .not('crm_location_id', 'is', null)
      .eq('is_active', true),
    db
      .from('client_groups')
      .select('id')
      .or('status.eq.churned,is_internal.eq.true'),
  ]);
  if (clientRows.error) throw clientRows.error;
  if (skipGroups.error) throw skipGroups.error;

  const churned = new Set((skipGroups.data ?? []).map((row) => row.id));
  const clients = {
    data: (clientRows.data ?? []).filter((row) => !churned.has(row.group_id)),
  };

  const from = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const to = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000);
  let contactLookups = 0;
  /** One shape note per run is enough; see ctx.note beside the lookup. */
  let shapeNoted = false;
  /**
   * Practices with no calendar matching the booking-calendar name, and what they
   * have instead.
   *
   * The names matter as much as the count. "10 practices have no booking
   * calendar" sends somebody into ten sub-accounts to work out what is wrong;
   * the list of what each one actually holds usually answers it on sight — a
   * calendar renamed, an unrendered `{{location.name}}` merge field, or nothing
   * bookable at all. Since the listing is already fetched here to tell a quiet
   * fortnight from a missing calendar, keeping the names costs nothing.
   */
  const missingCalendar: { practice: string; has: string[] }[] = [];

  /*
   * Calendars that pass the name test and still are not consultations.
   *
   * Every one of them is called "... Booking Calendar", so the name rule lets
   * them through: they are PatientSync mirrors, blocked slots, an appointment
   * setter call-back list, somebody's personal calendar. Fifteen of them held
   * 2,068 of the 2,397 events this sync reads -- one practice's mirrors alone
   * dwarfed every real booking in the agency.
   *
   * They were cleared out by hand once. Without reading that decision back
   * here the next run simply re-imported them, so the clear-out lasted until
   * the following evening and the consultation count went back to being seven
   * times too high.
   */
  const excluded = await db.from('excluded_calendars').select('crm_calendar_id');
  if (excluded.error) throw excluded.error;

  const excludedCalendars = new Set(
    (excluded.data ?? []).map((row) => row.crm_calendar_id),
  );

  let skippedByCalendar = 0;

  for (const client of clients.data ?? []) {
    if (!client.crm_location_id) continue;

    let events: GhlAppointment[];
    try {
      events = await listAppointments(
        client.id,
        client.crm_location_id,
        from,
        to,
        /*
         * Excluded before the per-location calendar cap, not after.
         *
         * A practice with nine calendars ending "Booking Calendar" and a cap of
         * eight could otherwise have its real one crowded out by mirrors, and
         * would read as a practice with no bookings at all. Filtering here also
         * saves a request per mirror.
         */
        (calendar) =>
          isConsultationCalendar(calendar) &&
          !excludedCalendars.has(calendar.id),
      );
    } catch (error) {
      // One client's dead token must not stop the other twenty.
      ctx.recordError(`could not list appointments for ${client.name}`, {
        clientId: client.id,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    // Belt and braces. The calendars were filtered before fetching, so this
    // should never drop anything — it costs nothing and catches an event
    // reporting a different calendar from the one it was fetched under.
    const admissible = events.filter(
      (event) =>
        event.calendarId === null || !excludedCalendars.has(event.calendarId),
    );

    skippedByCalendar += events.length - admissible.length;
    ctx.counts.skipped += events.length - admissible.length;
    events = admissible;

    ctx.counts.read += events.length;

    if (events.length === 0) {
      /*
       * Nothing came back, and the two reasons are worth telling apart: a quiet
       * fortnight, or no calendar named "… Booking Calendar" at all. Only asked
       * for locations that returned nothing, so the extra request is paid where
       * there is a problem rather than on every location every run.
       */
      try {
        const calendars = await listCalendars(client.id, client.crm_location_id);
        if (!calendars.some(isConsultationCalendar)) {
          missingCalendar.push({
            practice: client.name,
            has: calendars
              .map((calendar) => (calendar.name ?? '').trim())
              .filter((name) => name !== ''),
          });
        }
      } catch {
        // The listing already failed above if the token is dead; a failure here
        // is not worth a second error against the same client.
      }
      continue;
    }

    const ids = events.map((event) => event.id);
    const byCrmId = new Map<string, AppointmentRow>();

    // Batched: PostgREST puts the id list in the query string, and a busy
    // location has hundreds of events, which produced a bare "Bad Request"
    // from a URL that was simply too long.
    for (const batch of chunk(ids, ID_LOOKUP_BATCH)) {
      const existing = await db
        .from('appointments')
        .select('*')
        .eq('client_id', client.id)
        .in('crm_appointment_id', batch);
      if (existing.error) throw existing.error;

      for (const row of existing.data ?? []) {
        if (row.crm_appointment_id) byCrmId.set(row.crm_appointment_id, row);
      }
    }

    for (const event of events) {
      const current = byCrmId.get(event.id);
      const mapped = mapStatus(event);

      // Enrich from the contact record: name, phone and the attribution that
      // makes /ads-performance mean anything.
      let contact = null;
      /*
       * Enrich once, not forever.
       *
       * This used to also re-request whenever utm_source was null, which read
       * as "retry until we have attribution". But almost no contact here HAS
       * attribution — see the contact_shape note below — so that condition was
       * permanently true, and the lookup budget was spent re-fetching the same
       * few hundred bookings on every run. 2,398 appointments had 200 names
       * between them and were never going to gain more, while the run kept
       * reporting that "the rest will be enriched on the next pass".
       *
       * patient_name is the right sentinel: any contact that exists has one, so
       * its presence means this booking has already been through enrichment and
       * a missing utm_source is the answer rather than a gap. Each run now
       * spends its budget on bookings it has never looked at, and the backlog
       * actually drains.
       */
      const needsContact =
        event.contactId !== null &&
        contactLookups < MAX_CONTACT_LOOKUPS &&
        (!current || current.patient_name === null);

      if (needsContact && event.contactId) {
        try {
          contact = await getContact(client.id, event.contactId);
          contactLookups += 1;

          /*
           * Record what a contact payload actually carried, once per run.
           *
           * Across 2,398 bookings, not one had a utm_campaign or an ad id,
           * while 173 had a source — and from the database alone there is no
           * way to tell "these patients came from forms, not ads" apart from
           * "we are reading the wrong key". Key names answer that; the values
           * are patient details and are deliberately not recorded.
           */
          if (contact && !shapeNoted) {
            ctx.note('contact_shape', contact.shape);
            shapeNoted = true;
          }
        } catch (error) {
          ctx.recordError(`contact lookup failed for ${event.id}`, {
            clientId: client.id,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const incoming: Partial<AppointmentRow> = {
        crm_contact_id: event.contactId,
        crm_calendar_id: event.calendarId,
        scheduled_at: event.startsAt,
        scheduled_end_at: event.endsAt,
        status: mapped.status,
        address: event.address,
        patient_name: contact?.name ?? null,
        patient_email: contact?.email ?? null,
        patient_phone: contact?.phone ?? null,
        attribution_source: contact?.source ?? null,
        utm_source: contact?.attribution.utmSource ?? null,
        utm_medium: contact?.attribution.utmMedium ?? null,
        utm_campaign: contact?.attribution.utmCampaign ?? null,
        utm_content: contact?.attribution.utmContent ?? null,
        utm_term: contact?.attribution.utmTerm ?? null,
        ad_external_id: contact?.attribution.adId ?? null,
        campaign_external_id: contact?.attribution.campaignId ?? null,
        booked_at: event.createdAt,
        ...(mapped.showed === null
          ? {}
          : { showed: mapped.showed, showed_source: 'crm' }),
      };

      if (!current) {
        const insert = await db.from('appointments').insert({
          client_id: client.id,
          funnel: 'b2c',
          crm_appointment_id: event.id,
          scheduled_at: event.startsAt,
          source: 'crm',
          synced_at: new Date().toISOString(),
          ...authoritative(incoming, [
            'crm_contact_id',
            'crm_calendar_id',
            'scheduled_end_at',
            'status',
            'showed',
            'showed_source',
            'address',
            'patient_name',
            'patient_email',
            'patient_phone',
            'attribution_source',
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_content',
            'utm_term',
            'ad_external_id',
            'campaign_external_id',
            'booked_at',
          ]),
        });

        if (insert.error) {
          ctx.recordError(`could not create appointment ${event.id}`, {
            clientId: client.id,
            detail: insert.error.message,
          });
          continue;
        }

        ctx.counts.created += 1;
        continue;
      }

      // A moved booking is the same booking. Update it, and keep a record of
      // where it came from so the reschedule is visible rather than silent.
      const moved = current.scheduled_at !== event.startsAt;

      /*
       * Attendance is the one field both sides report, and they can disagree.
       * The clinic was in the room, so once they have answered through the
       * portal the CRM stops overwriting it — otherwise the next sync pass
       * silently replaces the only first-hand account we have, and nobody
       * notices until the month's treatment revenue is short.
       *
       * The booking STATUS stays authoritative either way: a cancellation is
       * the CRM's to report, and it is a different question from attendance.
       */
      const clinicAnswered = current.showed_source === 'client';

      const patch: Partial<AppointmentRow> = {
        ...authoritative(incoming, [
          'crm_contact_id',
          'crm_calendar_id',
          'scheduled_at',
          'scheduled_end_at',
          'status',
          'booked_at',
        ]),
        ...(clinicAnswered
          ? {}
          : authoritative(incoming, ['showed', 'showed_source'])),
        // These may have been typed by a person in the portal.
        ...humanOwned(current, incoming, [
          'patient_name',
          'patient_email',
          'patient_phone',
          'address',
          'attribution_source',
          'utm_source',
          'utm_medium',
          'utm_campaign',
          'utm_content',
          'utm_term',
          'ad_external_id',
          'campaign_external_id',
        ]),
        ...(moved
          ? {
              rescheduled_from: current.scheduled_at,
              reschedule_count: current.reschedule_count + 1,
            }
          : {}),
        synced_at: new Date().toISOString(),
      };

      const update = await db
        .from('appointments')
        .update(patch)
        .eq('id', current.id);

      if (update.error) {
        ctx.recordError(`could not update appointment ${event.id}`, {
          clientId: client.id,
          detail: update.error.message,
        });
        continue;
      }

      ctx.counts.updated += 1;
    }
  }

  ctx.note('contact_lookups', contactLookups);

  /*
   * How much backlog is left.
   *
   * Recorded every run so "the rest catch up on the next pass" is a claim
   * somebody can check rather than take on trust. If this number does not fall
   * between runs, enrichment is stuck again and the reason will be a condition
   * like the one that used to be here.
   */
  const backlog = await db
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .is('patient_name', null);

  if (!backlog.error) ctx.note('awaiting_contact_enrichment', backlog.count ?? 0);

  if (contactLookups >= MAX_CONTACT_LOOKUPS) {
    // Say so out loud rather than letting a partial enrichment look complete.
    ctx.recordError(
      `contact lookup cap of ${MAX_CONTACT_LOOKUPS} reached — ` +
        `${backlog.count ?? 'some'} booking(s) still await enrichment and are ` +
        'picked up on the next run',
    );
  }

  /*
   * How many mirror calendars were left unread.
   *
   * Recorded per run so the drop from 2,397 events to 323 has something standing
   * behind it. It counts calendars rather than events on purpose: they are
   * excluded before anything is fetched, so the events on them are never read and
   * cannot be counted. The event-level check exists as a backstop and its counter
   * should stay at zero — if it ever does not, a calendar is returning events
   * that claim to belong to a different one.
   */
  ctx.note('mirror_calendars_skipped', excludedCalendars.size);

  if (skippedByCalendar > 0) {
    ctx.recordError(
      `${skippedByCalendar} event(s) came back from a calendar that was ` +
        'supposed to have been excluded before fetching. The calendar-level ' +
        'filter is not holding, so check excluded_calendars against the ids on ' +
        'those events.',
      { events: skippedByCalendar },
    );
  }

  if (missingCalendar.length > 0) {
    ctx.note('no_booking_calendar', missingCalendar);

    /*
     * Split by whether there is anything to rename. A practice holding calendars
     * under other names is a five-minute fix by whoever owns GoHighLevel; a
     * practice holding none at all never had one provisioned, which is a
     * different job for a different person. Reported as one number they were
     * indistinguishable.
     */
    const renameable = missingCalendar.filter((row) => row.has.length > 0);
    const empty = missingCalendar.filter((row) => row.has.length === 0);

    ctx.recordError(
      `${missingCalendar.length} practice(s) have no calendar whose name ends ` +
        '"Booking Calendar", so no consultations were read for them. ' +
        `${renameable.length} hold calendars under other names and can be fixed ` +
        `by renaming; ${empty.length} hold no calendars at all and need one ` +
        'created.',
      {
        renameable: renameable.map(
          (row) => `${row.practice}: ${row.has.join(' | ')}`,
        ),
        no_calendars_at_all: empty.map((row) => row.practice),
      },
    );
  }
}
