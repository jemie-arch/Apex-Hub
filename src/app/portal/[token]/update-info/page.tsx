import { notFound } from 'next/navigation';

import {
  PracticeDetailsForm,
  type PracticeDetails,
} from '@/components/portal/PracticeDetailsForm';
import { tenant } from '@/config/tenant.config';
import { formatDateInZone } from '@/lib/format';
import { resolvePortal } from '@/lib/portal';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Practice details',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
}

/** Reads whatever shape the stored hours are in without trusting it. */
function readHours(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

export default async function PortalUpdateInfoPage({ params }: PageProps) {
  const portal = await resolvePortal(params.token);
  if (!portal) notFound();

  const group = await serviceClient()
    .from('client_groups')
    .select(
      'contact_name, contact_email, contact_phone, website, address_line1, address_line2, city, region, postal_code, country, opening_hours, details_updated_at',
    )
    .eq('id', portal.group.id)
    .maybeSingle();

  if (group.error) throw group.error;
  if (!group.data) notFound();

  const row = group.data;

  const details: PracticeDetails = {
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    website: row.website,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
    hours: readHours(row.opening_hours),
  };

  return (
    <>
      <h2 className="text-lg font-semibold text-fg">Practice details</h2>
      <p className="mb-6 mt-0.5 text-sm text-fg-muted">
        Correct anything that is wrong. What you save here stands — our systems
        never overwrite it.
        {row.details_updated_at
          ? ` Last updated ${formatDateInZone(
              row.details_updated_at,
              tenant.defaultTimezone,
            )}.`
          : ''}
      </p>

      <PracticeDetailsForm token={params.token} details={details} />
    </>
  );
}
