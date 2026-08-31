/**
 * Make scenario configuration into the sheet-target audit.
 *
 * This exists because a class of fault in the automations is invisible to the
 * people looking at them. Each Google Sheets module holds the spreadsheet id it
 * writes to and a separate cached label for display, and the label is never
 * re-resolved after the file is first picked. So a scenario can show the correct
 * practice on every module and address a different practice's file, and no
 * amount of opening it in Make will reveal that.
 *
 * Finding it needs ids compared across every scenario at once — which no person
 * is going to do twice, and which is trivial for a table. Hence this.
 *
 * Read-only. Nothing in this file or in the client it uses can modify a
 * scenario; these are live client automations and the audit has no business
 * touching them. What it produces is a list for a human to act on.
 */
import {
  listScenarios,
  resolveTeamId,
  sheetTargets,
  type MakeScenario,
} from '@/lib/integrations/make';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';
import type { TablesInsert } from '@/types/database';

/**
 * Only the scenarios that write a practice's bookings into a stat sheet.
 *
 * The team holds several hundred scenarios across five types per practice, and
 * every one of them touches sheets. Auditing all of them would be one blueprint
 * fetch each on a rate-limited API for no gain: the booking scenario is the one
 * that creates the row every other type later updates, so a wrong target there
 * is the fault that matters. Widening this is a one-line change when the rest
 * are worth the requests.
 */
const AUDITED_PREFIX = '01 - PPS - New Appointment Booked';

/**
 * Blueprint fetches are one request each against a rate-limited API, so the
 * cycle gets a ceiling. Set above the real population — 59 at the time of
 * writing — so it is a runaway guard rather than a silent cap; if it ever binds,
 * the sync says so instead of quietly auditing a subset.
 */
const MAX_BLUEPRINTS = 120;

export async function syncScenarioAudit(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  const teamId = await resolveTeamId();
  ctx.note('make_team', teamId);

  const all = await listScenarios(teamId);
  ctx.counts.read = all.length;
  ctx.note('scenarios_in_team', all.length);

  const audited = all.filter((s) => s.name.startsWith(AUDITED_PREFIX));
  ctx.note('scenarios_audited', audited.length);

  if (audited.length === 0) {
    /*
     * Raised rather than logged. An empty result here does not mean "all clear",
     * it means the naming convention moved and the audit is now looking at
     * nothing — which would otherwise present as a permanently clean report.
     */
    ctx.recordError(
      `No scenario name starts with ${AUDITED_PREFIX}, so nothing was audited. ` +
        'The naming convention has probably changed; update AUDITED_PREFIX.',
      { scenariosInTeam: all.length },
    );
    return;
  }

  /*
   * The module count comes free on the list response, so the generations can be
   * counted without spending a single blueprint fetch. Worth noting because an
   * odd one out is a signal on its own: when this was first run, 12 scenarios
   * had three sheet modules, 44 had eight, and exactly one had thirteen — and
   * the outlier was the only scenario doing something genuinely different.
   */
  const shapes = new Map<number, number>();
  for (const scenario of audited) {
    shapes.set(
      scenario.sheetModuleCount,
      (shapes.get(scenario.sheetModuleCount) ?? 0) + 1,
    );
  }
  ctx.note(
    'module_count_shapes',
    Object.fromEntries([...shapes].sort((a, b) => a[0] - b[0])),
  );

  if (audited.length > MAX_BLUEPRINTS) {
    ctx.recordError(
      `${audited.length} scenarios match, above the ${MAX_BLUEPRINTS} ceiling, ` +
        `so only the first ${MAX_BLUEPRINTS} were read. Raise MAX_BLUEPRINTS — ` +
        'the rest are unaudited, not clean.',
      { matched: audited.length, ceiling: MAX_BLUEPRINTS },
    );
  }

  const rows: TablesInsert<'scenario_sheet_targets'>[] = [];
  const seen: number[] = [];
  let failed = 0;

  for (const scenario of audited.slice(0, MAX_BLUEPRINTS)) {
    let targets;
    try {
      targets = await sheetTargets(scenario.id);
    } catch (error) {
      /*
       * One unreadable blueprint must not cost the other 55. Recorded per
       * scenario so a systematic failure (an expired token, a wrong zone) reads
       * as many errors rather than one mystery, and named so it can be retried
       * by hand.
       */
      failed += 1;
      ctx.recordError(
        `Could not read the blueprint for ${scenario.name}, so its sheet ` +
          'targets are unknown and its previous rows are left in place.',
        {
          scenarioId: scenario.id,
          detail: error instanceof Error ? error.message : String(error),
        },
      );
      continue;
    }

    seen.push(scenario.id);

    for (const target of targets) {
      rows.push({
        scenario_id: scenario.id,
        scenario_name: scenario.name,
        folder: practiceOf(scenario),
        is_active: scenario.isActive,
        last_edited_at: scenario.lastEditedAt,
        last_edited_by: scenario.lastEditedBy,
        module_id: target.moduleId,
        operation: target.operation,
        spreadsheet_id: target.spreadsheetId,
        label: target.label,
        id_was_padded: target.idWasPadded,
        observed_at: new Date().toISOString(),
      });
    }
  }

  if (rows.length === 0) {
    ctx.recordError(
      'Every blueprint read produced no Google Sheets modules at all, which is ' +
        'not a shape these scenarios have. Nothing was written.',
      { scenariosRead: seen.length },
    );
    return;
  }

  const written = await db
    .from('scenario_sheet_targets')
    .upsert(rows, { onConflict: 'scenario_id,module_id' });
  if (written.error) throw written.error;

  ctx.counts.updated = rows.length;
  ctx.note('modules_recorded', rows.length);
  ctx.note('blueprints_read', seen.length);
  if (failed > 0) ctx.note('blueprints_failed', failed);

  /*
   * Clear out modules that no longer exist, but only for the scenarios actually
   * read this run. Deleting on the basis of a scenario we failed to fetch would
   * turn a token problem into a vanished audit trail — the report would go quiet
   * exactly when it was least trustworthy.
   */
  if (seen.length > 0) {
    const stale = await db
      .from('scenario_sheet_targets')
      .delete()
      .in('scenario_id', seen)
      .lt('observed_at', new Date(Date.now() - 60_000).toISOString());
    if (stale.error) {
      ctx.recordError(
        'Recorded this run fine, but could not remove modules that have since ' +
          'been deleted, so the audit may show a module that no longer exists.',
        { detail: stale.error.message },
      );
    }
  }

  /*
   * Report the findings count, and name the severe ones. This is the part
   * somebody reads: a count alone would tell them a number and not which
   * practice to look at.
   */
  const findings = await db
    .from('scenario_sheet_findings')
    .select('practice, finding, modules, belongs_to, severity')
    .eq('severity', 1);

  if (findings.error) {
    ctx.recordError(
      'Targets were recorded, but the findings view could not be read, so this ' +
        'run cannot say whether anything is misdirected.',
      { detail: findings.error.message },
    );
    return;
  }

  const serious = findings.data ?? [];
  ctx.note('findings_severity_1', serious.length);

  if (serious.length > 0) {
    ctx.recordError(
      `${serious.length} scenario module(s) address a sheet that does not ` +
        'belong to their practice, or read one nothing writes to: ' +
        serious
          .map(
            (f) =>
              `${f.practice ?? 'unknown'} (${f.finding}, module ${f.modules}` +
              (f.belongs_to ? ` → ${f.belongs_to}` : '') +
              ')',
          )
          .join('; ') +
        '. These are configuration faults; whether they have executed has to be ' +
        'checked in the target sheet, not in Make.',
      { findings: serious },
    );
  } else {
    ctx.log('Every audited scenario writes only to its own sheet.');
  }
}

/**
 * The practice a scenario belongs to.
 *
 * Prefers the folder, because that is what somebody would say out loud, and
 * falls back to the bracketed suffix in the name — a handful of scenarios sit
 * outside any folder and carry the practice only in `[Brackets]`.
 */
function practiceOf(scenario: MakeScenario): string | null {
  if (scenario.folder) return scenario.folder;
  const match = scenario.name.match(/\[(.+)\]\s*$/);
  return match ? match[1]!.trim() : null;
}
