import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  ConsultationForm,
  type ConsultationDetail,
} from '@/components/portal/ConsultationForm';
import { StatusPill, appointmentStatusTone } from '@/components/ui/StatusPill';
import { tenant } from '@/config/tenant.config';
import { formatDateTimeInZone, zoneAbbreviation } from '@/lib/format';
import { resolvePortal } from '@/lib/portal';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Consultation',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string; id: string };
}

/**
 * One consultation.
 *
 * The id in the URL is not trusted: the query below filters by the locations
 * the token resolves to, so somebody else's appointment id is a 404 here
 * rather than a readable record.
 */
export default async function PortalConsultationPage({ params }: PageProps) {
  const portal = await resolvePortal(params.token);
  if (!portal) notFound();

  const result = await serviceClient()
    .from('appointments')
    .select(
      'id, patient_name, patient_phone, patient_email, scheduled_at, status, showed, showed_source, outcome, value_cents, financing_approved, lead_quality, notes, client_id, booked_by_name, attribution_source',
    )
    .eq('id', params.id)
    .in('client_id', portal.locationIds)
    .maybeSingle();

  if (result.error) throw result.error;
  if (!result.data) notFound();

  const row = result.data;
  const location = portal.locations.find((entry) => entry.id === row.client_id);
  const zone = location?.timezone ?? tenant.defaultTimezone;

  const appointment: ConsultationDetail = {
    id: row.id,
    patientName: row.patient_name,
    scheduledAt: row.scheduled_at,
    status: row.status,
    showed: row.showed,
    showedSource: row.showed_source,
    outcome: row.outcome,
    valueCents: row.value_cents,
    financingApproved: row.financing_approved,
    leadQuality: row.lead_quality,
    notes: row.notes,
  };

  return (
    <>
      <Link
        href={`/portal/${params.token}/appointments`}
        className="mb-5 inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg"
      >
        <ArrowLeft size={13} />
        All {tenant.vocabulary.booking.plural}
      </Link>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-fg">
            {row.patient_name ?? 'Consultation'}
          </h2>
          <p className="numeric mt-0.5 text-sm text-fg-muted">
            {formatDateTimeInZone(row.scheduled_at, zone)}{' '}
            {zoneAbbreviation(zone)}
            {location && portal.locations.length > 1
              ? ` · ${location.name}`
              : ''}
          </p>
          {row.patient_phone || row.patient_email ? (
            <p className="mt-1 text-xs text-fg-subtle">
              {[row.patient_phone, row.patient_email].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>
        <StatusPill
          value={row.status}
          tone={appointmentStatusTone(row.status)}
        />
      </header>

      <ConsultationForm
        token={params.token}
        appointment={appointment}
        currency={portal.group.currency}
      />

      <p className="mt-4 text-xs text-fg-subtle">
        {row.booked_by_name
          ? `Booked by ${row.booked_by_name}. `
          : ''}
        Nothing you type here is overwritten by our systems — these answers are
        yours, and they are what our reporting on treatment value is built from.
      </p>
    </>
  );
}
