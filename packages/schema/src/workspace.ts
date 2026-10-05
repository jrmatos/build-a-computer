import { z } from 'zod';
import { ChipMap } from './chip';
import { normalizeKind, SAVE_KIND, WORKSPACE_KIND } from './kinds';
import { Progress } from './progress';
import { IMPORT_LIMITS, ImportError, parseUntrustedJson, WORKSPACE_LIMITS } from './safe-parse';
import { migrateSave, NewerVersionError, Save } from './save';

/**
 * A whole workspace in one file: progress, every level's board and the custom
 * chip library. v1 of Build a Computer has no backend (owner decision 2026-10-05):
 * this file is how a player keeps, moves and backs up their work.
 *
 * Size limit: 20 MB (WORKSPACE_LIMITS), against 5 MB for a single-board save.
 * Depth and prototype-key protection are unchanged (E-DATA-03).
 */
export const WORKSPACE_VERSION = 1;

export const WorkspaceSettings = z.object({
  theme: z.enum(['light', 'dark']).optional(),
  showGrid: z.boolean().optional(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettings>;

const AchId = z.string().min(1).max(64);
const IdList = z.array(AchId).max(2000);

/**
 * Achievements earned on this device (local only, ADR-008). Additive and
 * optional, so files from before achievements still load and no version bump
 * is needed. Ids unknown to this app are kept (a newer app may know them).
 * Import merges: union of unlocks with the earliest timestamp, union of id
 * lists, max of counters (apps/web/src/achievements/engine.ts).
 */
export const WorkspaceAchievements = z.object({
  /** Unlocked achievement id -> when it was first earned. */
  unlocked: z
    .record(AchId, z.object({ at: z.string().datetime() }))
    .refine((o) => Object.keys(o).length <= 1000, 'Too many achievements')
    .default({}),
  /** Facts the rules need that progress does not hold. */
  stats: z
    .object({
      /** Test runs started, all levels. */
      runs: z.number().int().min(0).optional(),
      /** Levels with at least one finished test run. */
      tried: IdList.optional(),
      /** Levels whose very first test run passed. */
      firstPass: IdList.optional(),
      /** Levels where a hint was opened. */
      hinted: IdList.optional(),
      /** Levels whose solution was shown (ADR-007): no skill achievements there. */
      revealed: IdList.optional(),
      /** Levels first completed on the first test run. */
      clean: IdList.optional(),
      /** Levels first completed without opening a hint. */
      noHints: IdList.optional(),
      /** Levels solved with no more parts than the reference solution. */
      minimal: IdList.optional(),
    })
    .default({}),
});
export type WorkspaceAchievements = z.infer<typeof WorkspaceAchievements>;

export const WorkspaceV1 = z
  .object({
    /** Legacy 'ground-up/workspace' is accepted and normalized. */
    kind: z.preprocess(normalizeKind, z.literal(WORKSPACE_KIND)),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    appVersion: z.string().max(64).optional(),
    progress: Progress,
    /** Latest save per level id. Each save carries its own format version and migrates on its own. */
    saves: z.record(z.string().min(1).max(64), Save),
    chips: ChipMap.default({}),
    settings: WorkspaceSettings.optional(),
    /** Optional and additive: older files have none. */
    achievements: WorkspaceAchievements.optional(),
  })
  .superRefine((w, ctx) => {
    for (const [id, s] of Object.entries(w.saves)) {
      if (s.levelId !== id) ctx.addIssue({ code: 'custom', path: ['saves', id], message: `Save for ${s.levelId} stored under ${id}` });
    }
  });
export type Workspace = z.infer<typeof WorkspaceV1>;
export const Workspace = WorkspaceV1;

type Raw = Record<string, unknown>;

/** Workspace migrations, version N to N+1. Index i migrates i+1 -> i+2. None yet: v1 is the first. */
export const WORKSPACE_MIGRATIONS: ((data: Raw) => Raw)[] = [];

/**
 * Migrate any known workspace version to the latest, and every embedded save
 * to the latest save format (E-DATA-05). Refuses a newer workspace or a newer
 * embedded save with NewerVersionError (E-DATA-04). The input is untouched.
 * `opts` lets tests inject migration steps, a later latest version and its schema.
 */
export function migrateWorkspace(
  input: unknown,
  opts: { migrations?: ((data: Raw) => Raw)[]; latest?: number; schema?: z.ZodType<Workspace> } = {},
): Workspace {
  const { migrations = WORKSPACE_MIGRATIONS, latest = WORKSPACE_VERSION, schema = Workspace } = opts;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('Workspace must be an object');
  let data = structuredClone(input) as Raw;
  data.kind = normalizeKind(data.kind);
  if (data.kind !== WORKSPACE_KIND) throw new TypeError('Not a Build a Computer workspace file');
  const version = typeof data.version === 'number' ? data.version : NaN;
  if (!Number.isInteger(version) || version < 1) throw new TypeError('Workspace has no valid version');
  if (version > latest) throw new NewerVersionError(version, latest);
  for (let v = version; v < latest; v++) {
    const step = migrations[v - 1];
    if (!step) throw new Error(`Missing workspace migration from version ${v}`);
    data = step(data);
  }
  const saves = data.saves;
  if (saves && typeof saves === 'object' && !Array.isArray(saves)) {
    const out: Raw = {};
    for (const [id, s] of Object.entries(saves as Raw)) out[id] = migrateSave(s);
    data = { ...data, saves: out };
  }
  return schema.parse(data);
}

export type ImportedFile = { kind: 'save'; save: Save } | { kind: 'workspace'; workspace: Workspace };

/**
 * Parse an imported file: a single-board save or a whole workspace, told apart
 * by `kind`. Workspaces may be 20 MB, saves 5 MB (E-DATA-03). Throws
 * ImportError for unreadable files, NewerVersionError for newer ones (E-DATA-04),
 * and zod errors for files that fail the schema.
 */
export function parseImportFile(text: string): ImportedFile {
  const data = parseUntrustedJson(text, WORKSPACE_LIMITS);
  const kind = normalizeKind((data as { kind?: unknown } | null)?.kind);
  if (kind === WORKSPACE_KIND) return { kind: 'workspace', workspace: migrateWorkspace(data) };
  if (kind === SAVE_KIND) {
    if (new TextEncoder().encode(text).length > IMPORT_LIMITS.maxBytes) throw new ImportError('File is larger than 5 MB.');
    return { kind: 'save', save: migrateSave(data) };
  }
  throw new ImportError('This is not a Build a Computer save or workspace file.');
}
