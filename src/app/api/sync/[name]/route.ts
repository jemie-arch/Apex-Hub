/**
 * The HTTP face of every sync. It does no work of its own — it authorises the
 * caller and hands off to the same function the CLI calls, so a sync cannot
 * behave differently depending on how it was started.
 *
 * Vercel cron is the ONE scheduler for this app. Do not add a CI job that hits
 * these routes as well; two schedulers against one database means two runs
 * racing on the same rows.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { serverEnv } from '@/lib/env';
import { findSync, PLANNED_SYNCS } from '@/lib/sync/registry';
import { runSync } from '@/lib/sync/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorised(request: NextRequest): boolean {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;

  const provided = header.slice('Bearer '.length);
  const expected = serverEnv().CRON_SECRET;

  // Length-independent compare is overkill for a cron secret, but constant
  // work costs nothing here.
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < provided.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { name: string } },
) {
  if (!authorised(request)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const { name } = params;

  if (PLANNED_SYNCS.includes(name)) {
    // Answer honestly rather than 404ing or writing a misleading sync_runs row.
    return NextResponse.json(
      { name, status: 'not_implemented' },
      { status: 501 },
    );
  }

  const definition = findSync(name);
  if (!definition) {
    return NextResponse.json({ error: `unknown sync "${name}"` }, { status: 404 });
  }

  try {
    const result = await runSync(definition.name, 'cron', definition.run);

    // A failed sync returns 500 so the platform's cron log shows red. The
    // sync_runs row is already written either way.
    return NextResponse.json(result, {
      status: result.status === 'error' ? 500 : 200,
    });
  } catch (error) {
    // runSync can throw before it manages to open its sync_runs row — a bad
    // service-role key, for instance. Left unhandled that becomes a blank 500
    // with nothing to diagnose, so say what happened.
    return NextResponse.json(
      {
        name,
        status: 'failed_before_start',
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

/** POST is allowed so an admin can trigger a run from settings. */
export const POST = GET;
