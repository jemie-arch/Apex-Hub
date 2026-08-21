import { Megaphone } from 'lucide-react';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { chunk, ID_LOOKUP_BATCH } from '@/lib/chunk';
import { resolvePortal } from '@/lib/portal';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Your ads',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
}

/**
 * The creatives running for this practice.
 *
 * No spend, no cost per lead: that is our side of the arrangement and it is on
 * the results page in the terms that matter to them — bookings. This page
 * answers a different question, which is "what are patients actually seeing".
 */
export default async function PortalCreativesPage({ params }: PageProps) {
  const portal = await resolvePortal(params.token);
  if (!portal) notFound();

  const db = serviceClient();
  const ads: Array<{
    id: string;
    name: string;
    platform: string;
    status: string | null;
    creative_thumb_url: string | null;
    preview_url: string | null;
    client_id: string;
  }> = [];

  for (const ids of chunk(portal.locationIds, ID_LOOKUP_BATCH)) {
    const result = await db
      .from('ads')
      .select(
        'id, name, platform, status, creative_thumb_url, preview_url, client_id',
      )
      .in('client_id', ids)
      .order('name')
      .limit(200);

    if (result.error) throw result.error;
    ads.push(...(result.data ?? []));
  }

  const locationById = new Map(portal.locations.map((row) => [row.id, row.name]));
  const showLocation = portal.locations.length > 1;

  const live = ads.filter((ad) => ad.status === 'ACTIVE');
  const other = ads.filter((ad) => ad.status !== 'ACTIVE');

  function Card({ ad }: { ad: (typeof ads)[number] }) {
    return (
      <article className="overflow-hidden rounded-lg border border-line bg-surface">
        {ad.creative_thumb_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote ad
          // thumbnails come from the ad platform's CDN on domains we do not
          // control, so they cannot be listed for next/image.
          <img
            src={ad.creative_thumb_url}
            alt=""
            className="h-40 w-full bg-surface-sunken object-cover"
          />
        ) : (
          <div className="flex h-40 w-full items-center justify-center bg-surface-sunken text-fg-subtle">
            <Megaphone size={22} />
          </div>
        )}
        <div className="p-4">
          <p className="text-sm font-medium text-fg">{ad.name}</p>
          <p className="mt-1 flex items-center gap-2 text-xs text-fg-subtle">
            {ad.platform}
            {showLocation ? ` · ${locationById.get(ad.client_id) ?? ''}` : ''}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <StatusPill
              value={ad.status ?? 'unknown'}
              tone={ad.status === 'ACTIVE' ? 'positive' : 'neutral'}
            />
            {ad.preview_url ? (
              <a
                href={ad.preview_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-accent hover:underline"
              >
                See it as a patient does
              </a>
            ) : null}
          </div>
        </div>
      </article>
    );
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-fg">Your ads</h2>
      <p className="mb-6 mt-0.5 text-sm text-fg-muted">
        What patients are seeing. Tell us if anything here is wrong about your
        practice — that is worth more to us than a polite silence.
      </p>

      {ads.length === 0 ? (
        <EmptyState
          title="Nothing running yet"
          description={
            'Once your campaigns go live, every creative appears here with a ' +
            'link to view it the way a patient sees it.'
          }
          icon={<Megaphone size={22} />}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((ad) => (
              <Card key={ad.id} ad={ad} />
            ))}
          </div>

          {other.length > 0 ? (
            <section className="mt-8">
              <h3 className="mb-3 text-sm font-semibold text-fg">
                Paused and finished
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {other.map((ad) => (
                  <Card key={ad.id} ad={ad} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
