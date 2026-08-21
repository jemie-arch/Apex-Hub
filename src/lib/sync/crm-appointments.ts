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
  type GhlAppointment,
} from '@/lib/integrations/ghl';
import { authoritative, humanOwned } from '@/lib/sync/merge';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/** How far back and forward to look. Bounded so this cannot grow unbounded. */
const LOOKBACK_DAYS = 45;
const LOOKAHEAD_DAYS = 90;

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

  // Active sub-accounts whose business has not churned. Resolved as two
  // queries and filtered in memory rather than an embedded join, so the shape
  // stays obvious and the types stay exact.
  const [clientRows, churnedGroups] = await Promise.all([
    db
      .from('clients')
      .select('id, name, group_id, crm_location_id, timezone')
      .not('crm_location_id', 'is', null)
      .eq('is_active', true),
    db.from('client_groups').select('id').eq('status', 'churned'),
  ]);
  if (clientRows.error) throw clientRows.error;
  if (churnedGroups.error) throw churnedGroups.error;

  const churned = new Set((churnedGroups.data ?? []).map((row) => row.id));
  const clients = {
    data: (clientRows.data ?? []).filter((row) => !churned.has(row.group_id)),
  };

  const from = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const to = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000);
  let contactLookups = 0;

  for (const client of clients.data ?? []) {
    if (!client.crm_location_id) continue;

    let events: GhlAppointment[];
    try {
      events = await listAppointments(
        client.id,
        client.crm_location_id,
        from,
        to,
      );
    } catch (error) {
      // One client's dead token must not stop the other twenty.
      ctx.recordError(`could not list appointments for ${client.name}`, {
        clientId: client.id,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    ctx.counts.read += events.length;
    if (events.length === 0) continue;

    const ids = events.map((event) => event.id);
    const existing = await db
      .from('appointments')
      .select('*')
      .eq('client_id', client.id)
      .in('crm_appointment_id', ids);
    if (existing.error) throw existing.error;

    const byCrmId = new Map<string, AppointmentRow>();
    for (const row of existing.data ?? []) {
      if (row.crm_appointment_id) byCrmId.set(row.crm_appointment_id, row);
    }

    for (const event of events) {
      const current = byCrmId.get(event.id);
      const mapped = mapStatus(event);

      // Enrich from the contact record: name, phone and the attribution that
      // makes /ads-performance mean anything.
      let contact = null;
      const needsContact =
        event.contactId !== null &&
        contactLookups < MAX_CONTACT_LOOKUPS &&
        (!current || current.patient_name === null || current.utm_source === null);

      if (needsContact && event.contactId) {
        try {
          contact = await getContact(client.id, event.contactId);
          contactLookups += 1;
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
        ...(mapped.showed === null ? {} : { showed: mapped.showed }),
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

      const patch: Partial<AppointmentRow> = {
        ...authoritative(incoming, [
          'crm_contact_id',
          'crm_calendar_id',
          'scheduled_at',
          'scheduled_end_at',
          'status',
          'showed',
          'booked_at',
        ]),
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

  if (contactLookups >= MAX_CONTACT_LOOKUPS) {
    // Say so out loud rather than letting a partial enrichment look complete.
    ctx.recordError(
      `contact lookup cap of ${MAX_CONTACT_LOOKUPS} reached — some bookings ` +
        'are missing attribution and will be enriched on the next run',
    );
  }
}
