import { notFound } from 'next/navigation';

import { CardDetailsForm } from '@/components/portal/CardDetailsForm';
import { InviteRequestForm } from '@/components/portal/InviteRequestForm';
import { CARD_DETAILS_FORM_ID, resolvePortal } from '@/lib/portal';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Account',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
}

/**
 * The practice's own details: who they are, who else should have access, and
 * the card we bill.
 *
 * The three sit together because they are the questions a practice manager
 * arrives with, and none of them is about appointments. Card details are handled
 * by an embedded provider form rather than by us — see CardDetailsForm.
 */
export default async function PortalAccountPage({ params }: PageProps) {
  const portal = await resolvePortal(params.token);
  if (!portal) notFound();

  return (
    <>
      <h2 className="text-lg font-semibold text-fg">Account</h2>
      <p className="mb-6 mt-0.5 max-w-xl text-sm text-fg-muted">
        Your practice details, who else can see this, and the card we bill.
      </p>

      <section className="mb-8 rounded-lg border border-line bg-surface p-5">
        <h3 className="text-sm font-semibold text-fg">Practice</h3>
        <p className="mt-2 text-base text-fg">{portal.group.name}</p>

        {portal.locations.length > 1 ? (
          <>
            <p className="mt-4 text-xs uppercase tracking-wide text-fg-subtle">
              Locations
            </p>
            <ul className="mt-1.5 space-y-1">
              {portal.locations.map((location) => (
                <li key={location.id} className="text-sm text-fg-muted">
                  {location.name}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <p className="mt-4 text-xs text-fg-subtle">
          Something wrong here? Tell us on the Support page and we will correct
          it — these come from our records rather than being editable directly,
          so a change reaches the people who need to know.
        </p>
      </section>

      <section className="mb-8 rounded-lg border border-line bg-surface p-5">
        <h3 className="text-sm font-semibold text-fg">Invite a colleague</h3>
        <p className="mb-4 mt-1 max-w-xl text-sm text-fg-muted">
          Anyone at {portal.group.name} can have their own link. Please ask here
          rather than forwarding yours — a separate link can be switched off on
          its own if somebody leaves, and yours keeps working. We approve the
          request before the link is issued.
        </p>

        <InviteRequestForm token={params.token} />
      </section>

      <section className="rounded-lg border border-line bg-surface p-5">
        <h3 className="text-sm font-semibold text-fg">Billing details</h3>
        <p className="mb-4 mt-1 max-w-xl text-sm text-fg-muted">
          Update the card we charge for booked consultations.
        </p>

        <CardDetailsForm
          formId={CARD_DETAILS_FORM_ID}
          practiceName={portal.group.name}
        />
      </section>
    </>
  );
}
