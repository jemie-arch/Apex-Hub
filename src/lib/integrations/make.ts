/**
 * Make.com, read-only.
 *
 * Two questions: which scenarios exist, and where does each one's Google Sheets
 * module actually write. That is all the audit needs, and it is the only thing
 * this module asks for.
 *
 * The token is held in the environment, never written to the database, never
 * logged and never sent to the browser — the same rule the GoHighLevel, Stripe
 * and Hubstaff modules follow.
 *
 * Nothing here writes. There is no update, activate or delete call in this file
 * on purpose: these scenarios are live client automations, and the blast radius
 * of a bug on a write path is somebody's practice losing its bookings. If a fix
 * ever needs applying programmatically it belongs in its own module, behind its
 * own explicit confirmation, not next to the reader.
 */
import { makeCredentials } from '@/lib/env';

export interface MakeScenario {
  id: number;
  name: string;
  isActive: boolean;
  isInvalid: boolean;
  folder: string | null;
  lastEditedAt: string | null;
  lastEditedBy: string | null;
  /**
   * How many google-sheets modules the scenario uses, straight off the list
   * response. This is free — it means the audit can tell the scenario
   * generations apart, and spot an odd one out, without fetching a single
   * blueprint.
   */
  sheetModuleCount: number;
}

/** One google-sheets module's actual target, plus the name Make shows for it. */
export interface SheetTarget {
  moduleId: number;
  /** addRow, updateRow, filterRows, and so on. */
  operation: string;
  /** What the data really follows. Null when the module has none set. */
  spreadsheetId: string | null;
  /**
   * The display label, which is a cache written when somebody picked the file
   * and never re-resolved afterwards. Kept precisely so the audit can show how
   * far it has drifted from the id — that gap is the whole point.
   */
  label: string | null;
  /** True when the raw id had leading or trailing whitespace before trimming. */
  idWasPadded: boolean;
}

interface RawScenario {
  id?: unknown;
  name?: unknown;
  isActive?: unknown;
  isinvalid?: unknown;
  folderPath?: unknown;
  lastEdit?: unknown;
  usedPackages?: unknown;
  updatedByUser?: { name?: unknown } | null;
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

async function get<T>(path: string): Promise<T> {
  const { token, apiBase } = makeCredentials();

  const response = await fetch(`${apiBase}${path}`, {
    method: 'GET',
    headers: {
      authorization: `Token ${token}`,
      accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text();
    /*
     * The body is included because Make's 401 has two very different causes —
     * a bad token, and a token issued in a different zone — and they are
     * indistinguishable from the status alone. That distinction is the whole
     * diagnosis, and it is in the body.
     */
    throw new Error(
      `Make ${path} responded ${response.status}: ${body.slice(0, 1200)}`,
    );
  }

  return (await response.json()) as T;
}

/**
 * The team whose scenarios get audited.
 *
 * Discovered rather than demanded, for the same reason the Hubstaff
 * organisation is: a token belongs to a person and that person usually has
 * exactly one team, so requiring the id would fail on a value nobody knew to
 * look up. If there are several and none is configured, this names them instead
 * of guessing.
 */
export async function resolveTeamId(): Promise<string> {
  const configured = makeCredentials().teamId;
  if (configured) return configured;

  const body = await get<{
    organizations?: { teams?: { id?: unknown; name?: unknown }[] }[];
  }>('/organizations');

  const teams = (body.organizations ?? []).flatMap((org) =>
    (org.teams ?? []).flatMap((team) => {
      const id = text(team.id);
      return id ? [{ id, name: text(team.name) ?? id }] : [];
    }),
  );

  if (teams.length === 0) {
    throw new Error(
      'The Make token can see no teams. Check it belongs to a member of the ' +
        'Apex organisation and was issued in the same zone as MAKE_API_BASE.',
    );
  }
  if (teams.length > 1) {
    throw new Error(
      'The Make token can see several teams, so which one to audit is ' +
        'ambiguous. Set MAKE_TEAM_ID to one of: ' +
        teams.map((t) => `${t.name} (${t.id})`).join(', '),
    );
  }

  return teams[0]!.id;
}

/** Every scenario in the team, with just the fields the audit reads. */
export async function listScenarios(teamId: string): Promise<MakeScenario[]> {
  const body = await get<{ scenarios?: RawScenario[] }>(
    `/scenarios?teamId=${encodeURIComponent(teamId)}`,
  );

  return (body.scenarios ?? []).flatMap((row) => {
    const id = text(row.id);
    if (!id) return [];

    const packages = Array.isArray(row.usedPackages) ? row.usedPackages : [];

    return [
      {
        id: Number(id),
        name: text(row.name) ?? `scenario ${id}`,
        isActive: row.isActive === true,
        isInvalid: row.isinvalid === true,
        folder: text(row.folderPath),
        lastEditedAt: text(row.lastEdit),
        lastEditedBy: text(row.updatedByUser?.name ?? null),
        sheetModuleCount: packages.filter((p) => p === 'google-sheets').length,
      },
    ];
  });
}

/**
 * Pull the spreadsheet target out of every google-sheets module in a scenario.
 *
 * Walks the whole blueprint rather than the top-level flow, because the modules
 * that matter most sit inside router branches — and in the scenarios that turned
 * out to be misdirected, it was always a module inside a branch. Reading only
 * the top level would have found none of them.
 */
export async function sheetTargets(scenarioId: number): Promise<SheetTarget[]> {
  const body = await get<{ scenario?: { blueprint?: unknown } }>(
    `/scenarios/${scenarioId}?confidential=false`,
  );

  const found: SheetTarget[] = [];
  walk(body.scenario?.blueprint, found);
  found.sort((a, b) => a.moduleId - b.moduleId);
  return found;
}

function walk(node: unknown, out: SheetTarget[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  const moduleName = record.module;

  if (typeof moduleName === 'string' && moduleName.startsWith('google-sheets:')) {
    out.push(readModule(record, moduleName));
  }

  for (const key of Object.keys(record)) walk(record[key], out);
}

function readModule(
  record: Record<string, unknown>,
  moduleName: string,
): SheetTarget {
  const mapper = (record.mapper ?? {}) as Record<string, unknown>;
  const rawId = typeof mapper.spreadsheetId === 'string' ? mapper.spreadsheetId : null;

  return {
    moduleId: Number(text(record.id) ?? 0),
    operation: moduleName.slice('google-sheets:'.length),
    spreadsheetId: normaliseId(rawId),
    label: readLabel(record),
    /*
     * Whitespace is worth reporting rather than quietly trimming. One scenario
     * carried a trailing newline on both of its lookup modules and nowhere else
     * — 45 characters against 44 — which is invisible in the interface and
     * exactly the kind of thing a silent trim would hide from the report.
     */
    idWasPadded: rawId !== null && rawId !== rawId.trim(),
  };
}

/**
 * Make stores the id one of two ways depending on the module's search mode:
 * bare, or as a Drive path like `/folderId/fileId`. The last segment is the
 * file either way.
 */
function normaliseId(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!trimmed.includes('/')) return trimmed;

  const segments = trimmed.split('/').filter((segment) => segment !== '');
  return segments.length > 0 ? segments[segments.length - 1]! : null;
}

/**
 * The cached display name, which lives in one of two shapes: a flat `label` for
 * a picked file, or a `path` array for one chosen by folder. Both are stale by
 * construction.
 */
function readLabel(record: Record<string, unknown>): string | null {
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const restore = (metadata.restore ?? {}) as Record<string, unknown>;
  const expect = (restore.expect ?? {}) as Record<string, unknown>;
  const spreadsheet = (expect.spreadsheetId ?? {}) as Record<string, unknown>;

  const flat = text(spreadsheet.label);
  if (flat) return flat;

  const path = spreadsheet.path;
  if (Array.isArray(path) && path.length > 0) {
    return text(path[path.length - 1]);
  }

  return null;
}
