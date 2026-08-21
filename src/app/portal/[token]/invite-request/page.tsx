import { notFound } from 'next/navigation';

import { InviteRequestForm } from '@/components/portal/InviteRequestForm';
import { resolvePortal } from '@/lib/portal';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Add a colleague',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
}

export default async function PortalInviteRequestPage({ params }: PageProps) {
  const portal = await resolvePortal(params.token);
  if (!portal) notFound();

  return (
    <>
      <h2 className="text-lg font-semibold text-fg">Add a colleague</h2>
      <p className="mb-6 mt-0.5 max-w-xl text-sm text-fg-muted">
        Anyone at {portal.group.name} can have their own link. Please ask here
        rather than forwarding this one — a separate link can be turned off on
        its own if somebody leaves, and yours keeps working.
      </p>

      <InviteRequestForm token={params.token} />
    </>
  );
}
