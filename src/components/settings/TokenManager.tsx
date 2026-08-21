'use client';

/**
 * Location token manager for the marketplace install.
 *
 * With an agency-level install, a location token is minted from the Company
 * token rather than obtained through its own OAuth handshake — so this table
 * shows which locations currently hold a valid token and lets you reissue the
 * ones that do not, without touching GoHighLevel.
 */
import { KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  forgetToken,
  mintAllMissing,
  mintToken,
  type TokenActionResult,
} from '@/app/(app)/settings/token-actions';
import { Button } from '@/components/ui/Button';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { tenant, titleCase } from '@/config/tenant.config';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';

export interface TokenRow {
  clientId: string;
  locationName: string;
  businessName: string;
  crmLocationId: string;
  isActive: boolean;
  expiresAt: string | null;
  lastError: string | null;
  mintedFromAgency: boolean;
}

function tokenState(row: TokenRow): { label: string; tone: Tone } {
  if (row.lastError) return { label: 'error', tone: 'negative' };
  if (!row.expiresAt) return { label: 'none', tone: 'neutral' };

  const remaining = new Date(row.expiresAt).getTime() - Date.now();
  if (remaining <= 0) return { label: 'expired', tone: 'warning' };

  // Under an hour is worth flagging: a sync starting now might outlive it.
  if (remaining < 3_600_000) return { label: 'expiring', tone: 'warning' };

  return { label: 'valid', tone: 'positive' };
}

function whenUtc(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ');
}

export function TokenManager({
  rows,
  agencyConnected,
}: {
  rows: TokenRow[];
  agencyConnected: boolean;
}) {
  const [result, setResult] = useState<TokenActionResult | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const location = tenant.vocabulary.location;

  const missing = rows.filter((row) => tokenState(row).label !== 'valid').length;

  function run(id: string | null, action: () => Promise<TokenActionResult>) {
    setPendingId(id);
    setResult(null);
    startTransition(async () => {
      setResult(await action());
      setPendingId(null);
    });
  }

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <KeyRound size={14} /> {titleCase(location.singular)} tokens
          </h2>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Minted from the agency install — no per-{location.singular} sign-in
            needed. {formatCount(missing)} of {formatCount(rows.length)} need
            attention.
          </p>
        </div>

        <Button
          size="sm"
          variant="primary"
          icon={<RefreshCw size={13} />}
          disabled={!agencyConnected || isPending || missing === 0}
          onClick={() => run('__all__', mintAllMissing)}
        >
          {pendingId === '__all__' ? 'Minting…' : 'Mint all missing'}
        </Button>
      </div>

      {!agencyConnected ? (
        <p className="px-4 py-6 text-sm text-fg-muted">
          Connect the agency install above first. Every {location.singular}{' '}
          token is issued from it.
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-fg-muted">
          No {location.plural} with a CRM id yet. Run crm-clients to bring them
          in.
        </p>
      ) : (
        <>
          {result ? (
            <p
              className={cn(
                'mx-4 mt-3 rounded-md px-3 py-2 text-sm',
                result.ok
                  ? 'bg-positive-subtle text-positive'
                  : 'bg-negative-subtle text-negative',
              )}
            >
              {result.message}
            </p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">
                    {titleCase(location.singular)}
                  </th>
                  <th className="px-4 py-3 font-medium">Token</th>
                  <th className="px-4 py-3 font-medium">Expires (UTC)</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const state = tokenState(row);
                  const busy = isPending && pendingId === row.clientId;

                  return (
                    <tr
                      key={row.clientId}
                      className="border-b border-line last:border-0"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-fg">
                          {row.locationName}
                        </span>
                        <span className="block text-xs text-fg-subtle">
                          {row.businessName}
                          {row.isActive ? '' : ' · paused'}
                        </span>
                        {row.lastError ? (
                          <span className="mt-1 block max-w-md text-xs text-negative">
                            {row.lastError}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill value={state.label} tone={state.tone} />
                      </td>
                      <td className="numeric px-4 py-3 text-fg-muted">
                        {whenUtc(row.expiresAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            disabled={isPending}
                            onClick={() =>
                              run(row.clientId, () => mintToken(row.clientId))
                            }
                          >
                            {busy ? 'Minting…' : 'Mint'}
                          </Button>
                          {row.expiresAt ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label={`Forget the stored token for ${row.locationName}`}
                              icon={<Trash2 size={13} />}
                              disabled={isPending}
                              onClick={() =>
                                run(row.clientId, () =>
                                  forgetToken(row.clientId),
                                )
                              }
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="border-t border-line px-4 py-3 text-xs text-fg-subtle">
            Minted tokens carry no refresh token, so they are reissued on expiry
            rather than refreshed. A sync mints automatically when it finds one
            missing — this table is for seeing and repairing, not for routine
            use.
          </p>
        </>
      )}
    </section>
  );
}
