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

import {
  listOpportunities,
  listPipelines,
  type GhlOpportunity,
} from '@/lib/integrations/ghl';
import { authoritative, humanOwned } from '@/lib/sync/merge';
import { classifyOrigin } from '@/config/lead-origin';
import { getContact } from '@/lib/integrations/ghl';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/**
 * Contact lookups per run, for the tags that identify a referral.
 *
 * One request each, so it is capped. Deals with no origin yet are done first, so
 * a backlog drains instead of the same rows being re-read every run — the
 * mistake that left the appointment enrichment spinning for weeks.
 */
const MAX_CONTACT_LOOKUPS = 150;

/**
 * Keyword -> stage. First match wins, so order matters.
 *
 * The stages that actually exist in the b2b sub-account, read off its three
 * pipelines: New Lead, Replied, In Contact, Demo Booked, Demo Showed, Sent
 * Email, No Answer AM, No Answer PM. Not the set this list was first written
 * against — that came from a description of the funnel rather than from the
 * pipelines, and "booked call" and "showed call" are in none of them.
 *
 * 'closed' and 'nurture' sit at the top because they must be tested before
 * anything looser matches. There was also a 'demo' -> call_showed entry, which
 * matched "Demo Booked" and promoted a booking to an attendance; it is gone, and
 * "Demo Booked" now falls to 'booked' where it belongs.
 */
const DEFAULT_STAGE_KEYWORDS: ReadonlyArray<[string, DealStage]> = [
  ['closed', 'won'],
  ['nurture', 'nurture'],
  ['proposal', 'proposal'],
  ['contract', 'proposal'],
  ['showed', 'call_showed'],
  // A reply is a contact in any pipeline. It is also the only stage in the b2b
  // sub-account with anything in it, and it read as 'new' until now.
  ['replied', 'contacted'],
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
  stageName: string | null,
  overrides: Record<string, string>,
): DealStage {
  // A closed opportunity is closed regardless of which stage it sits in.
  const status = (opportunity.status ?? '').toLowerCase();
  if (status === 'won') return 'won';
  if (status === 'lost' || status === 'abandoned') return 'lost';

  const name = (stageName ?? '').toLowerCase();

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
    // Recorded rather than logged, for the same reason as windsor-ads: a sync
    // that cannot run must not be filed as a success that found nothing.
    ctx.recordError(
      'app_settings.b2b_location_id is not set, so there is no pipeline to ' +
        'read — set it to the GoHighLevel location holding the agency\'s own ' +
        'sales pipeline',
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

  /*
   * The stage names, which the opportunity itself does not carry.
   *
   * /opportunities/search returns pipelineStageId and no name, so every stage
   * arrived as an opaque id, matched nothing in the keyword list or the
   * configured map, and fell through to 'new'. That is why the entire b2b
   * pipeline read as untouched new leads. A failure here is recorded rather than
   * fatal: the deals are still worth importing with their stage unresolved, and
   * the run says so instead of quietly filing them all under 'new' again.
   */
  const stageNameById = new Map<string, string>();
  const pipelineNameByStageId = new Map<string, string>();

  try {
    for (const pipeline of await listPipelines(owner.data?.id ?? null, locationId)) {
      for (const stage of pipeline.stages) {
        stageNameById.set(stage.id, stage.name);
        pipelineNameByStageId.set(stage.id, pipeline.name);
      }
    }
  } catch (error) {
    ctx.recordError('could not read the pipeline stages, so stages are unresolved', {
      locationId,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  ctx.counts.read = opportunities.length;
  ctx.log(
    `${opportunities.length} opportunity(ies) from ${locationId}, ` +
      `${stageNameById.size} stage(s) named`,
  );

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

  /*
   * Which deals already know where they came from.
   *
   * Read up front so the lookup budget is spent on deals that have never been
   * classified, rather than re-fetching contacts whose tags we already hold.
   */
  const known = await db
    .from('deals')
    .select('crm_opportunity_id, origin')
    .neq('origin', 'unknown');
  if (known.error) throw known.error;

  const alreadyClassified = new Set(
    (known.data ?? []).flatMap((row) =>
      row.crm_opportunity_id ? [row.crm_opportunity_id] : [],
    ),
  );

  let contactLookups = 0;
  const originCounts = new Map<string, number>();

  for (const opportunity of opportunities) {
    const stageName =
      opportunity.stageName ??
      (opportunity.stageId ? (stageNameById.get(opportunity.stageId) ?? null) : null);
    const pipelineName = opportunity.stageId
      ? (pipelineNameByStageId.get(opportunity.stageId) ?? null)
      : null;

    const stage = mapStage(opportunity, stageName, overrides);
    if (stage === 'new' && (stageName ?? '').toLowerCase() !== 'new lead') {
      // Named or not. An id with no name is the more serious case, so it is
      // reported as one rather than skipped.
      unmappedStages.add(stageName ?? `unnamed stage ${opportunity.stageId ?? '?'}`);
    }

    const valueCents =
      opportunity.monetaryValue === null ||
      !Number.isFinite(opportunity.monetaryValue)
        ? null
        : Math.max(0, Math.round(opportunity.monetaryValue * 100));

    const ownerUserId = opportunity.assignedUserId
      ? (userIdByCrm.get(opportunity.assignedUserId) ?? null)
      : null;

    /*
     * Where the lead came from.
     *
     * Referrals are the reason this is here: they carry no utm and no ad id, so
     * the tag somebody put on the contact is the only evidence that exists. That
     * costs a request per contact, so it is bounded and skipped for deals already
     * classified.
     */
    let tags: string[] = [];
    let contactRead = false;
    let origin = classifyOrigin({
      tags: [],
      source: opportunity.source,
      utmSource: null,
      utmMedium: null,
      campaignId: null,
      adId: null,
    });

    if (
      opportunity.contactId &&
      !alreadyClassified.has(opportunity.id) &&
      contactLookups < MAX_CONTACT_LOOKUPS
    ) {
      contactLookups += 1;
      try {
        const contact = await getContact(
          // The sub-account's own token when it is one of our clients rows, which
          // it is: the sales account is registered. getContact needs a client id,
          // and this is the same one the opportunity listing used.
          owner.data?.id ?? locationId,
          opportunity.contactId,
        );
        if (contact) {
          contactRead = true;
          tags = contact.tags;
          origin = classifyOrigin({
            tags: contact.tags,
            source: contact.source ?? opportunity.source,
            utmSource: contact.attribution.utmSource,
            utmMedium: contact.attribution.utmMedium,
            campaignId: contact.attribution.campaignId,
            adId: contact.attribution.adId,
          });
        }
      } catch (error) {
        // One unreadable contact must not cost the other hundred their stage.
        ctx.recordError('could not read contact tags', {
          opportunityId: opportunity.id,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    originCounts.set(origin, (originCounts.get(origin) ?? 0) + 1);

    const incoming: Partial<DealRow> = {
      crm_contact_id: opportunity.contactId,
      tags,
      origin,
      practice_name: opportunity.name,
      contact_name: opportunity.contactName,
      contact_email: opportunity.contactEmail,
      contact_phone: opportunity.contactPhone,
      stage,
      stage_name: stageName,
      pipeline_name: pipelineName,
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
          'stage_name',
          'pipeline_name',
          'tags',
          'origin',
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
        'stage_name',
        'pipeline_name',
        'value_cents',
        'owner_user_id',
        'synced_at',
      ]),
      /*
       * Only when the contact was actually read this run. With the lookup budget
       * spent, the tag list is empty and the origin is a guess from the source field
       * alone, and writing that would erase a referral somebody had tagged.
       */
      ...(contactRead ? authoritative(incoming, ['tags', 'origin']) : {}),
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

  if (originCounts.size > 0) {
    ctx.note(
      'leads_by_origin',
      Object.fromEntries([...originCounts.entries()].sort((a, b) => b[1] - a[1])),
    );
  }
  ctx.note('contact_lookups_used', contactLookups);

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
