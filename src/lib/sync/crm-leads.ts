/**
 * Leads from GoHighLevel — the feed the Hub never had.
 *
 * WHY IT EXISTS
 *
 * Joshua reports that the Hub's lead numbers do not agree with GoHighLevel.
 * They cannot: no sync has ever read leads from the CRM. What the Hub reports
 * is greatest(Windsor, the tracker sheet), and Meta returns zero for 35 of the
 * 39 accounts that spent money last month. So the disagreement is a missing
 * feed rather than a miscount — and neither side of the argument can be
 * settled until both counts sit next to each other.
 *
 * This fills crm_leads. v_lead_reconciliation puts the three side by side.
 *
 * WHAT COUNTS AS A LEAD
 *
 * A contact created in the window, by dateAdded. Not a tag and not a pipeline
 * stage: both are configured per sub-account by whoever built the automation,
 * so counting them would compare practices by their CRM setup rather than by
 * how many people enquired.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not write to GoHighLevel. It does not delete: a contact removed in
 * the CRM stays here, because a lead that arrived and was later tidied away
 * still cost what it cost to acquire.
 *
 * FIRST RUN IS A DISCOVERY RUN
 *
 * /contacts/ has not been read before. The field names come from
 * GoHighLevel's documentation rather than from a live payload — the same
 * position the tracker import was in when it demanded "booked for" from a
 * sheet that says "Date Booked" and failed twice. So it reports the key names
 * it received, how many contacts it could not place, and whether it hit its
 * page cap. Key names and counts only; never a value.
 */
import { serverEnv } from '@/lib/env';
import { listContacts } from '@/lib/integrations/ghl';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

const BATCH = 200;

/**
 * How far back to look each night.
 *
 * Fourteen rather than the usual thirty: a contact's dateAdded never changes,
 * so re-reading old days only re-writes rows that cannot have moved. Two weeks
 * is enough to absorb a few nights of failure and short enough that the run
 * costs one or two pages per practice.
 */
const WINDOW_DAYS = 14;

/** Practices per run. The cycle has a 240s start budget to respect. */
const MAX_CLIENTS = 60;

export async function syncCrmLeads(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  const windowDays = (() => {
    const raw = serverEnv().CRM_LEADS_WINDOW_DAYS;
    if (raw === undefined) return WINDOW_DAYS;
    const parsed = Number(raw);
    // Capped: a wide window here is a lot of pages against a rate-limited API.
    if (!Number.isFinite(parsed) || parsed < 1) return WINDOW_DAYS;
    return Math.min(Math.trunc(parsed), 180);
  })();

  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 86_400_000);

  ctx.note('window_days', windowDays);

  /*
   * Only practices with a CRM location. A client with no location_id has no
   * sub-account to read, which is a mapping gap rather than a sync failure —
   * crm-clients is what fills it.
   */
  const clients = await db
    .from('clients')
    .select('id, name, crm_location_id')
    .not('crm_location_id', 'is', null)
    .order('name')
    .limit(MAX_CLIENTS);

  if (clients.error) throw clients.error;

  const rows = clients.data ?? [];

  if (rows.length === 0) {
    ctx.recordError(
      'No client has a crm_location_id, so there is no sub-account to read ' +
        'leads from. Run crm-clients first.',
    );
    return;
  }

  ctx.note('practices_considered', rows.length);

  const records: Record<string, unknown>[] = [];
  const failures: string[] = [];
  const metaKeys = new Set<string>();
  const contactKeys = new Set<string>();
  const dateKeys = new Set<string>();

  let received = 0;
  let unusable = 0;
  let outsideWindow = 0;
  let pagesRead = 0;
  let truncatedFor = 0;
  let practicesRead = 0;
  let practicesWithNone = 0;

  for (const client of rows) {
    const locationId = client.crm_location_id;
    if (!locationId) continue;

    let page;
    try {
      page = await listContacts(client.id, locationId, from, to);
    } catch (error) {
      /*
       * One practice failing must not lose the rest. A revoked token is the
       * common cause and it is specific to that sub-account, so it is recorded
       * by name and the loop continues.
       */
      failures.push(
        `${client.name}: ${
          error instanceof Error ? error.message.slice(0, 160) : 'unknown'
        }`,
      );
      continue;
    }

    practicesRead += 1;
    received += page.shape.received;
    unusable += page.shape.unusable;
    outsideWindow += page.shape.outsideWindow;
    pagesRead += page.shape.pages;
    if (page.shape.truncated) truncatedFor += 1;
    for (const key of page.shape.metaKeys) metaKeys.add(key);
    for (const key of page.shape.contactKeys) contactKeys.add(key);
    for (const key of page.shape.dateKeysSeen) dateKeys.add(key);

    if (page.contacts.length === 0) practicesWithNone += 1;

    for (const contact of page.contacts) {
      const addedAt = contact.createdAtUtc;
      if (addedAt === null) {
        unusable += 1;
        continue;
      }

      records.push({
        client_id: client.id,
        crm_contact_id: contact.id,
        created_at_utc: addedAt,
        // The UTC calendar date, which is what the other two feeds are
        // grained by. The instant is kept beside it so a midnight lead can be
        // explained rather than argued about.
        created_on: addedAt.slice(0, 10),
        lead_name: contact.name,
        lead_email: contact.email,
        lead_phone: contact.phone,
        source: contact.source,
        tags: contact.tags,
        utm_source: contact.attribution.utmSource,
        utm_medium: contact.attribution.utmMedium,
        utm_campaign: contact.attribution.utmCampaign,
        ad_external_id: contact.attribution.adId,
        campaign_external_id: contact.attribution.campaignId,
        synced_at: new Date().toISOString(),
      });
    }
  }

  /*
   * One row per contact before writing, or Postgres rejects the whole batch.
   * "ON CONFLICT DO UPDATE command cannot affect row a second time" is what an
   * upsert says when the same key appears twice in one statement, and it is
   * why the first run read 7,966 contacts and wrote none of them.
   *
   * GoHighLevel's cursor paging overlaps: a contact updated while paging moves
   * position and arrives again on the next page. So the same id legitimately
   * appears more than once in one practice's read.
   *
   * The later copy wins. Pages come newest-first, so a repeat is the same
   * contact seen again, and keeping the last one keeps whatever GoHighLevel
   * most recently said about it.
   */
  const byContact = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    byContact.set(record['crm_contact_id'] as string, record);
  }
  const unique = [...byContact.values()];
  const duplicates = records.length - unique.length;

  ctx.counts.read = received;
  if (duplicates > 0) ctx.note('duplicate_contact_ids_collapsed', duplicates);

  // Key names, never values. This is the report that corrects the mapping if
  // GoHighLevel does not call these fields what the documentation says.
  ctx.note('contact_keys_seen', [...contactKeys].sort());
  ctx.note('meta_keys_seen', [...metaKeys].sort());
  ctx.note('date_keys_seen', [...dateKeys].sort());
  ctx.note('practices_read', practicesRead);
  ctx.note('practices_with_no_leads', practicesWithNone);
  /*
   * The arithmetic, closed.
   *
   * read minus outside-the-window minus duplicates should equal written, and
   * the first run reported only two of those four numbers — so 7,966 read
   * against 717 written looked like thousands of lost contacts when most were
   * simply older than the window.
   */
  ctx.note('contacts_outside_the_window', outsideWindow);
  ctx.note('pages_read', pagesRead);
  if (unusable > 0) ctx.note('contacts_unusable', unusable);
  if (truncatedFor > 0) ctx.note('practices_hitting_the_page_cap', truncatedFor);

  if (failures.length > 0) {
    ctx.recordError(
      `${failures.length} practice(s) could not be read: ${failures
        .slice(0, 5)
        .join('; ')}`,
      { count: failures.length },
    );
  }

  if (unique.length === 0) {
    /*
     * Recorded as a problem, not logged. Zero leads across every practice in
     * a fortnight is not a plausible business outcome, so it means the read is
     * wrong — most likely the date key or the endpoint — and the key names
     * noted above are how to tell which.
     */
    ctx.recordError(
      'No leads were read from any practice. Either the contacts endpoint ' +
        'returned nothing, or dateAdded is not the field it is assumed to be. ' +
        'Check contact_keys_seen and date_keys_seen above before changing the ' +
        'window.',
    );
    return;
  }

  for (let start = 0; start < unique.length; start += BATCH) {
    const batch = unique.slice(start, start + BATCH);
    const written = await db
      .from('crm_leads')
      .upsert(batch as never, { onConflict: 'crm_contact_id' });

    if (written.error) {
      ctx.recordError(
        `Could not write leads ${start + 1}–${start + batch.length}: ` +
          written.error.message,
        { from: start + 1, count: batch.length },
      );
      return;
    }
    ctx.counts.updated += batch.length;
  }

  /*
   * The comparison, stated in the log rather than left for somebody to run.
   * This is the number the whole sync exists to produce.
   */
  /*
   * Notes rather than ctx.log, which reaches console.log and nothing that
   * sync_runs records. These are the figures the sync exists to produce, so
   * they have to be readable from the run itself.
   */
  const dated = new Set(unique.map((row) => row['created_on'] as string));

  ctx.note('leads_written', unique.length);
  ctx.note('days_covered', dated.size);
  ctx.note('compare_in', 'v_lead_reconciliation');
}
