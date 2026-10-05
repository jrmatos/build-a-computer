import { z } from 'zod';
import { Board } from './board';
import { ChipMap } from './chip';
import { Level } from './level';
import { ImportError, parseUntrustedJson, WORKSPACE_LIMITS, type ParseLimits } from './safe-parse';
import { NewerVersionError } from './save';

/**
 * Community files (M14, ADR-008: no backend). Everything here travels as a
 * file or a link fragment the player owns; nothing is uploaded.
 *
 * - LevelPack (COM-02, COM-03): community levels plus a reference solution per
 *   level. A pack only installs levels whose reference passes and whose empty
 *   starter fails (checked in the worker on import).
 * - SharedBoard (COM-01): one board and the chips it uses, small enough for a
 *   compressed `#share=` URL fragment.
 */
export const PACK_KIND = 'build-a-computer/pack';
export const PACK_VERSION = 1;
export const SHARE_KIND = 'build-a-computer/share';
export const SHARE_VERSION = 1;

/** Pack slug: namespaces the pack's level ids on install (`pack-<slug>--<id>`). */
export const PackSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(1).max(20);

/** A reference solution: a board (board levels) or source text (code levels). */
export const PackSolution = z.union([
  z.object({ board: Board }),
  z.object({ source: z.string().max(1_000_000) }),
]);
export type PackSolution = z.infer<typeof PackSolution>;

export const LevelPackV1 = z
  .object({
    kind: z.literal(PACK_KIND),
    version: z.literal(1),
    /** Optional; derived from `name` when missing. */
    slug: PackSlug.optional(),
    name: z.string().min(1).max(80),
    author: z.string().max(80).optional(),
    description: z.string().max(2000).optional(),
    levels: z.array(Level).min(1).max(100),
    /** Reference solution per level id (un-namespaced, as in `levels`). */
    solutions: z.record(z.string().min(1).max(64), PackSolution),
    /** Custom chips used by the solution boards. */
    chips: ChipMap.default({}),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.levels.forEach((l, i) => {
      if (seen.has(l.id)) ctx.addIssue({ code: 'custom', path: ['levels', i, 'id'], message: `Duplicate level id ${l.id}` });
      seen.add(l.id);
    });
  });
export type LevelPack = z.infer<typeof LevelPackV1>;
export const LevelPack = LevelPackV1;

/** Lowercase-dash slug from a pack name, at most 20 characters ("pack" when nothing is left). */
export function slugify(name: string, max = 20): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return s || 'pack';
}

/** The pack's slug: its own, or one made from its name. */
export const packSlug = (p: Pick<LevelPack, 'slug' | 'name'>): string => p.slug ?? slugify(p.name);

/** True when untrusted parsed JSON says it is a level pack. */
export const isPackData = (data: unknown): boolean =>
  typeof data === 'object' && data !== null && (data as { kind?: unknown }).kind === PACK_KIND;

/**
 * Parse a pack file: E-DATA-03 limits (20 MB, depth 64, prototype keys
 * stripped), refuses newer versions (E-DATA-04), then the schema.
 */
export function parsePackFile(text: string, limits: ParseLimits = WORKSPACE_LIMITS): LevelPack {
  const data = parseUntrustedJson(text, limits);
  if (!isPackData(data)) throw new ImportError('This is not a Build a Computer level pack.');
  const version = (data as { version?: unknown }).version;
  if (typeof version === 'number' && version > PACK_VERSION) throw new NewerVersionError(version, PACK_VERSION);
  return LevelPack.parse(data);
}

/** A board shared by link or file (COM-01). */
export const SharedBoardV1 = z.object({
  kind: z.literal(SHARE_KIND),
  version: z.literal(1),
  /** Level the board was built for; forking offers that level when it exists and is open. */
  levelId: z.string().min(1).max(64).optional(),
  title: z.string().max(80).optional(),
  board: Board,
  chips: ChipMap.default({}),
});
export type SharedBoard = z.infer<typeof SharedBoardV1>;
export const SharedBoard = SharedBoardV1;
