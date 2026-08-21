'use server';

/**
 * Token management for the GoHighLevel marketplace install.
 *
 * The agency token is obtained once through OAuth. Every location token is
 * minted from it on demand, so this is the surface for seeing which locations
 * have a working token and reissuing the ones that do not.
 *
 * Admin-only, checked here: a server action is its own POST endpoint.
 */
import { revalidatePath } from 'next/cache';

import { mintLocationToken } from '@/lib/integrations/ghl';
import { requireAdmin } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export interface TokenActionResult {
  ok: boolean;
  message: string;
}

export async function mintToken(clientId: string): Promise<TokenActionResult> {
  await requireAdmin();

  try {
    const token = await mintLocationToken(clientId);
    revalidatePath('/settings');

    const expires = token.expiresAt
      ? new Date(token.expiresAt).toISOString().slice(0, 16).replace('T', ' ')
      : 'unknown';

    return { ok: true, message: `Minted — valid until ${expires} UTC.` };
  } catch (error) {
    // Record the failure on the row so it is visible later, not just now.
    await serviceClient()
      .from('oauth_tokens')
      .update({
        last_error: error instanceof Error ? error.message : String(error),
        refreshed_at: new Date().toISOString(),
      })
      .eq('provider', 'gohighlevel')
      .eq('client_id', clientId);

    revalidatePath('/settings');
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Could not mint a token.',
    };
  }
}

/**
 * Mints a token for every location that has none or whose token has expired.
 * Bounded and sequential: 45 concurrent mint calls would rate-limit, and a
 * partial result is reported rather than silently truncated.
 */
export async function mintAllMissing(): Promise<TokenActionResult> {
  await requireAdmin();

  const db = serviceClient();

  const [clients, tokens] = await Promise.all([
    db
      .from('clients')
      .select('id, name')
      .not('crm_location_id', 'is', null)
      .eq('is_active', true),
    db
      .from('oauth_tokens')
      .select('client_id, expires_at')
      .eq('provider', 'gohighlevel')
      .not('client_id', 'is', null),
  ]);

  if (clients.error) return { ok: false, message: clients.error.message };
  if (tokens.error) return { ok: false, message: tokens.error.message };

  const soon = Date.now() + 5 * 60 * 1000;
  const healthy = new Set(
    (tokens.data ?? [])
      .filter(
        (row) => row.expires_at && new Date(row.expires_at).getTime() > soon,
      )
      .flatMap((row) => (row.client_id ? [row.client_id] : [])),
  );

  const needed = (clients.data ?? []).filter((row) => !healthy.has(row.id));

  if (needed.length === 0) {
    return { ok: true, message: 'Every active location already has a valid token.' };
  }

  let minted = 0;
  const failures: string[] = [];

  for (const client of needed) {
    try {
      await mintLocationToken(client.id);
      minted += 1;
    } catch (error) {
      failures.push(
        `${client.name}: ${error instanceof Error ? error.message : 'failed'}`,
      );
    }
  }

  revalidatePath('/settings');

  if (failures.length === 0) {
    return { ok: true, message: `Minted ${minted} token(s).` };
  }

  return {
    ok: false,
    message:
      `Minted ${minted} of ${needed.length}. ` +
      `${failures.length} failed — ${failures.slice(0, 3).join('; ')}` +
      (failures.length > 3 ? ` and ${failures.length - 3} more.` : '.'),
  };
}

/**
 * Deletes a stored location token. The next sync mints a fresh one, so this is
 * a repair action rather than a way to switch a location off — use the
 * location's Active flag for that.
 */
export async function forgetToken(
  clientId: string,
): Promise<TokenActionResult> {
  await requireAdmin();

  const removed = await serviceClient()
    .from('oauth_tokens')
    .delete()
    .eq('provider', 'gohighlevel')
    .eq('client_id', clientId);

  if (removed.error) return { ok: false, message: removed.error.message };

  revalidatePath('/settings');
  return { ok: true, message: 'Forgotten. The next sync will mint a new one.' };
}
