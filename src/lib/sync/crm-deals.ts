/**
 * GoHighLevel opportunities -> deals (the b2b funnel).
 *
 * This is Apex selling retainers to practices, which is a different funnel from
 * a practice booking patients, so it lands in `deals` rather than
 * `appointments`. The two never share a table.
 *
 * The agency's own pipeline lives in one specific sub-account, and only a human
 * knows which. It is read from app_settings.b2b_location_id; without it this
 * sync does nothing and says so, rather than guessing and importing a
 * practice's patient pipeline as if it were new business.
 *
 * Stage mapping is also configurable. GoHighLevel stage names are per-pipeline
 * free text, so names are matched on keywords with a sane default and can be
 * overridden via app_settings.b2b_stage_map.
 */
import type { DealRow, DealStage } from '@/types/database';

import { listOpportunities, type GhlOpportunity } from '@/lib/integrations/ghl';
import { authoritative, humanOwned } from '@/lib/sync/merge';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/** Keyword -> stage. First match wins, so order matters. */
const DEFAULT_STAGE_KEYWORDS: ReadonlyArray<[string, DealStage]> = [
  ['proposal', 'proposal'],
  ['contract', 'proposal'],
  ['showed', 'call_showed'],
  ['demo', 'call_showed'],
  ['booked', 'call_booked'],
  ['scheduled', 'call_booked'],
  ['appointment', 'call_booked'],
  ['contacted', 'contacted'],
  ['follow', 'contacted'],
  ['lead', 'new'],
  ['new', 'new'],
];

function mapStage(
  opportunity: GhlOpportunity,
  overrides: Record<string, string>,
): DealStage {
  // A closed opportunity is closed regardless of which stage it sits in.
  const status = (opportunity.status ?? '').toLowerCase();
  if (status === 'won') return 'won';
  if (status === 'lost' || status === 'abandoned') return 'lost';

  const name = (opportunity.stageName ?? '').toLowerCase();

  const override = overrides[name] ?? (opportunity.stageId ? overrides[opportunity.stageId] : undefined);
  if (override && isDealStage(override)) return override;

  for (const [keyword, stage] of DEFAULT_STAGE_KEYWORDS) {
    if (name.includes(keyword)) return stage;
  }

  // Unrecognised open stage: 'new' is the least wrong answer, and the sync
  // reports the name so the map can be extended.
  return 'new';
}

function isDealStage(value: string): value is DealStage {
  return [
    'new',
    'contacted',
    'call_booked',
    'call_showed',
    'proposal',
    'won',
    'lost',
  ].includes(value);
}

export async function syncCrmDeals(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  const [locationSetting, mapSetting] = await Promise.all([
    db.from('app_settings').select('value').eq('key', 'b2b_location_id').maybeSingle(),
    db.from('app_settings').select('value').eq('key', 'b2b_stage_map').maybeSingle(),
  ]);

  const locationId =
    typeof locationSetting.data?.value === 'string'
      ? locationSetting.data.value
      : null;

  if (!locationId) {
    ctx.log(
      'app_settings.b2b_location_id is not set, so there is no pipeline to ' +
        'read. Set it to the GoHighLevel location holding Apex\'s own sales ' +
        'pipeline.',
    );
    return;
  }

  const overrides: Record<string, string> = {};
  if (mapSetting.data && typeof mapSetting.data.value === 'object' && mapSetting.data.value !== null) {
    for (const [key, value] of Object.entries(
      mapSetting.data.value as Record<string, unknown>,
    )) {
      if (typeof value === 'string') overrides[key.toLowerCase()] = value;
    }
  }

  // The pipeline sub-account may or may not be one of our clients rows. If it
  // is, use its per-client token; otherwise fall back to the agency token.
  const owner = await db
    .from('clients')
    .select('id')
    .eq('crm_location_id', locationId)
    .maybeSingle();
  if (owner.error) throw owner.error;

  let opportunities: GhlOpportunity[];
  try {
    opportunities = await listOpportunities(owner.data?.id ?? null, locationId);
  } catch (error) {
    ctx.recordError('could not read the b2b pipeline', {
      locationId,
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  ctx.counts.read = opportunities.length;
  ctx.log(`${opportunities.length} opportunity(ies) from ${locationId}`);

  const ids = opportunities.map((row) => row.id);
  const existing = ids.length
    ? await db.from('deals').select('*').in('crm_opportunity_id', ids)
    : { data: [], error: null };
  if (existing.error) throw existing.error;

  const byCrmId = new Map<string, DealRow>();
  for (const row of existing.data ?? []) {
    if (row.crm_opportunity_id) byCrmId.set(row.crm_opportunity_id, row);
  }

  // Attribute owners where the GoHighLevel user is linked to a profile.
  const profiles = await db
    .from('user_profiles')
    .select('id, crm_user_id')
    .not('crm_user_id', 'is', null);
  if (profiles.error) throw profiles.error;

  const userIdByCrm = new Map(
    (profiles.data ?? []).flatMap((row) =>
      row.crm_user_id ? [[row.crm_user_id, row.id] as const] : [],
    ),
  );

  const unmappedStages = new Set<string>();
  const now = new Date().toISOString();

  for (const opportunity of opportunities) {
    const stage = mapStage(opportunity, overrides);
    if (
      stage === 'new' &&
      opportunity.stageName &&
      !(opportunity.stageName.toLowerCase() in overrides)
    ) {
      unmappedStages.add(opportunity.stageName);
    }

    const valueCents =
      opportunity.monetaryValue === null ||
      !Number.isFinite(opportunity.monetaryValue)
        ? null
        : Math.max(0, Math.round(opportunity.monetaryValue * 100));

    const ownerUserId = opportunity.assignedUserId
      ? (userIdByCrm.get(opportunity.assignedUserId) ?? null)
      : null;

    const incoming: Partial<DealRow> = {
      crm_contact_id: opportunity.contactId,
      practice_name: opportunity.name,
      contact_name: opportunity.contactName,
      contact_email: opportunity.contactEmail,
      contact_phone: opportunity.contactPhone,
      stage,
      value_cents: valueCents,
      owner_user_id: ownerUserId,
      source: opportunity.source,
      first_contact_at: opportunity.createdAt,
      synced_at: now,
    };

    const current = byCrmId.get(opportunity.id);

    if (!current) {
      const insert = await db.from('deals').insert({
        funnel: 'b2b',
        crm_opportunity_id: opportunity.id,
        practice_name: opportunity.name,
        ...authoritative(incoming, [
          'crm_contact_id',
          'contact_name',
          'contact_email',
          'contact_phone',
          'stage',
          'value_cents',
          'owner_user_id',
          'source',
          'first_contact_at',
          'synced_at',
        ]),
        // Stamp the close date on arrival so a deal that syncs already-won is
        // still dated.
        ...(stage === 'won' ? { won_at: opportunity.updatedAt ?? now } : {}),
        ...(stage === 'lost' ? { lost_at: opportunity.updatedAt ?? now } : {}),
      });

      if (insert.error) {
        ctx.recordError(`could not create deal "${opportunity.name}"`, {
          opportunityId: opportunity.id,
          detail: insert.error.message,
        });
        continue;
      }

      ctx.counts.created += 1;
      continue;
    }

    const patch: Partial<DealRow> = {
      ...authoritative(incoming, [
        'crm_contact_id',
        'practice_name',
        'stage',
        'value_cents',
        'owner_user_id',
        'synced_at',
      ]),
      // Contact details and the lost reason may have been typed by a person.
      ...humanOwned(current, incoming, [
        'contact_name',
        'contact_email',
        'contact_phone',
        'source',
        'first_contact_at',
      ]),
      // Only stamp a close date the first time it closes.
      ...(stage === 'won' && current.won_at === null
        ? { won_at: opportunity.updatedAt ?? now }
        : {}),
      ...(stage === 'lost' && current.lost_at === null
        ? { lost_at: opportunity.updatedAt ?? now }
        : {}),
    };

    const update = await db.from('deals').update(patch).eq('id', current.id);
    if (update.error) {
      ctx.recordError(`could not update deal "${current.practice_name}"`, {
        dealId: current.id,
        detail: update.error.message,
      });
      continue;
    }

    ctx.counts.updated += 1;
  }

  if (unmappedStages.size > 0) {
    // Silently filing these as 'new' would quietly distort the pipeline board,
    // so name them and let a human extend the map.
    ctx.recordError(
      `${unmappedStages.size} pipeline stage name(s) did not match a known ` +
        'stage and were treated as "new". Add them to app_settings.b2b_stage_map.',
      { stages: [...unmappedStages] },
    );
  }
}
