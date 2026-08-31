/**
 * Which sheet each clinic's bookings belong in.
 *
 * This screen is the replacement for a spreadsheet id being pasted into 56
 * cloned Make scenarios, up to eight times each. That arrangement is why four
 * scenarios currently write into another practice's file, why one reads a file
 * nothing writes to, and why two practices share a file neither can prove it
 * owns — and why none of it was visible to anybody looking at Make.
 *
 * It is a screen rather than a migration for the same reason the ad-accounts
 * mapping is: only somebody who can open the file knows whether "Kind Dental -
 * Stat Sheet" is Kind Dental's or Kind Dental (GD)'s. The rows arrive proposed
 * and inert; verifying is a person saying they looked.
 *
 * Nothing here is published until the routing-export sync runs, and that sync
 * only reads verified rows.
 */
import { AlertTriangle, Route } from 'lucide-react';
import { redirect } from 'next/navigation';

import { ClinicRoutingRow } from '@/components/settings/ClinicRoutingRow';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { isPrivileged } from '@/config/roles';
import { formatCount } from '@/lib/format';
import { currentCaller } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Clinic routing' };

export default async function ClinicRoutingPage() {
  const caller = await currentCaller();
  if (!caller) redirect('/login');
  if (!isPrivileged(caller.role)) redirect('/dashboard');

  const db = serviceClient();

  const [routing, candidates, gaps] = await Promise.all([
    db
      .from('pps_clinic_routing')
      .select(
        'client_id, practice, crm_location_id, spreadsheet_id, source, verified_at',
      )
      .order('practice'),
    db
      .from('pps_routing_candidates')
      .select('client_id, scenario_practice, spreadsheet_id, is_exact'),
    db.from('pps_routing_gaps').select('practice, gap, all_candidates'),
  ]);

  if (routing.error) throw routing.error;

  const rows = routing.data ?? [];
  const proposals = candidates.error ? [] : (candidates.data ?? []);
  const unrouted = gaps.error ? [] : (gaps.data ?? []);

  /*
   * What each clinic's own scenario writes to today, so the row can flag a
   * disagreement. Only the exact-name proposals are used here: a containment
   * match is usually a sibling practice, and offering a sibling's sheet as "what
   * this clinic writes to" would be actively misleading.
   */
  const scenarioSheet = new Map<
    string,
    { sheetId: string | null; practice: string | null }
  >();
  for (const proposal of proposals) {
    if (!proposal.is_exact || !proposal.client_id) continue;
    scenarioSheet.set(proposal.client_id, {
      sheetId: proposal.spreadsheet_id,
      practice: proposal.scenario_practice,
    });
  }

  const inUse = rows.filter((row) => row.verified_at !== null);
  const waiting = rows.filter((row) => row.verified_at === null);

  return (
    <>
      <PageHeader
        title="Clinic routing"
        description="Where each clinic's bookings are written. One row per practice, replacing the same id pasted into every cloned scenario."
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KPICard label="In use" value={formatCount(inUse.length)} />
        <KPICard label="Awaiting a check" value={formatCount(waiting.length)} />
        <KPICard label="Not routable yet" value={formatCount(unrouted.length)} />
      </section>

      {/*
        The honest state of this screen, said once at the top rather than
        implied. Somebody arriving here needs to know that nothing they see is
        driving anything yet.
      */}
      <section className="mb-6 rounded-lg border border-accent-subtle bg-surface p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Route size={14} /> How this is wired
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-fg-subtle">
          A row reaches the automation only once it is verified, and only when the
          routing export runs. Verifying means somebody opened the sheet and it
          was this practice&rsquo;s — not that the name matched. The first attempt
          at matching these by name scored &ldquo;Cruz Orthodontics&rdquo; against
          &ldquo;Ofir Orthodontics&rdquo; highly enough to auto-accept, which is
          why it does not.
        </p>
        <p className="mt-1 max-w-3xl text-xs text-fg-subtle">
          A sheet claimed by two clinics is published for neither. That is
          deliberate: guessing which practice owns a shared file is how bookings
          end up in the wrong one.
        </p>
      </section>

      {rows.length > 0 && (
        <section className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-fg">
              Clinics and their sheets
            </h2>
            <p className="mt-1 text-xs text-fg-subtle">
              Paste a sheet URL or id to change one. Changing the id clears its
              check, because the check was of that exact file.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Practice</th>
                  <th className="px-4 py-3 font-medium">Sheet</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {[...waiting, ...inUse].map((row) => {
                  const scenario = scenarioSheet.get(row.client_id);
                  return (
                    <ClinicRoutingRow
                      key={row.client_id}
                      clientId={row.client_id}
                      practice={row.practice}
                      locationId={row.crm_location_id}
                      sheetId={row.spreadsheet_id}
                      verified={row.verified_at !== null}
                      source={
                        row.source === 'derived'
                          ? 'from its audited scenario'
                          : 'entered by hand'
                      }
                      scenarioSheetId={scenario?.sheetId ?? null}
                      scenarioPractice={scenario?.practice ?? null}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {unrouted.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-warning bg-surface">
          <div className="border-b border-warning-subtle px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-warning">
              <AlertTriangle size={14} /> Not routable yet
            </h2>
            <p className="mt-1 max-w-3xl text-xs text-fg-subtle">
              {formatCount(unrouted.length)} active clinic
              {unrouted.length === 1 ? '' : 's'} the consolidated scenario could
              not route. This has to reach zero before the per-practice clones
              can be retired — until then those practices stay on the old path,
              which still works and is still the thing being replaced.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Practice</th>
                  <th className="px-4 py-3 font-medium">Why</th>
                  <th className="px-4 py-3 font-medium">Proposals</th>
                </tr>
              </thead>
              <tbody>
                {unrouted.map((row) => (
                  <tr
                    key={row.practice}
                    className="border-b border-line last:border-0"
                  >
                    <td className="px-4 py-3 text-fg">{row.practice}</td>
                    <td className="px-4 py-3 text-fg-muted">{row.gap}</td>
                    <td className="px-4 py-3 text-fg-muted">
                      {row.all_candidates ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
