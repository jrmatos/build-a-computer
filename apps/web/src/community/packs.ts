/**
 * Community level packs (COM-03): content-check for untrusted packs, then
 * namespacing so pack levels never collide with built-in ones.
 *
 * Content-check, as for built-in levels (plan: Testing, `tools/content-check`):
 * schema valid (already parsed), a reference solution exists and passes, the
 * empty starter fails (E-RES-06), requirements are reachable and acyclic.
 * Pack-specific: board and code levels only, starter parts are locked, the
 * reference only places palette parts, and installed ids fit the 64-char limit.
 */
import { packSlug, type Board, type Level, type LevelPack, type PackSolution } from '@build-a-computer/schema';
import { findChipCycle } from '@build-a-computer/sim-logic';
import { checkLevel, type CheckHost, type Wrap } from './checker';

/** Installed id of a pack level: `pack-<slug>--<id>` (Level ids allow [a-z0-9-] only). */
export const namespacedId = (slug: string, id: string): string => `pack-${slug}--${id}`;
export const isPackLevelId = (id: string): boolean => /^pack-[a-z0-9-]+--[a-z0-9-]+$/.test(id);

export interface LevelReport {
  /** Id inside the pack file. */
  id: string;
  /** Id once installed. */
  installId: string;
  title: string;
  ok: boolean;
  problems: string[];
}

export interface PackReport {
  slug: string;
  name: string;
  levels: LevelReport[];
}

const hasBoard = (s: PackSolution | undefined): s is { board: Board } => !!s && 'board' in s;
const hasSource = (s: PackSolution | undefined): s is { source: string } => !!s && 'source' in s;

/** Problems that need no simulation, per level id (empty arrays for clean levels). Pure. */
export function staticIssues(pack: LevelPack, builtinIds: ReadonlySet<string>): Map<string, string[]> {
  const slug = packSlug(pack);
  const ids = new Set(pack.levels.map((l) => l.id));
  const out = new Map<string, string[]>(pack.levels.map((l) => [l.id, []]));
  const chipCycle = findChipCycle(pack.chips);
  for (const l of pack.levels) {
    const p = out.get(l.id)!;
    const sol = pack.solutions[l.id];
    if (namespacedId(slug, l.id).length > 64) p.push('The level id is too long once the pack name is added.');
    if (l.track === 'sandbox') p.push('A pack level cannot be a sandbox.');
    if (l.mode === 'js') p.push('JavaScript levels cannot be shared in packs yet.');
    if (l.tests.length === 0) p.push('The level has no tests.');
    if (l.tests.some((t) => t.kind === 'js')) p.push('The level uses a JavaScript test.');
    if (!sol) p.push('The pack has no reference solution for this level.');
    else if (l.mode === 'code' && !hasSource(sol)) p.push('A code level needs a source reference solution.');
    else if (l.mode === 'board' && !hasBoard(sol)) p.push('A board level needs a board reference solution.');
    if (l.mode === 'board') {
      if (l.starter.parts.some((pt) => !pt.locked)) p.push('Every starter part must be locked.');
      if (hasBoard(sol)) {
        const palette = new Set<string>(l.palette);
        const starterIds = new Set(l.starter.parts.map((pt) => pt.id));
        const placed = sol.board.parts.filter((pt) => !pt.locked && !starterIds.has(pt.id) && pt.type !== 'chip');
        const extra = [...new Set(placed.filter((pt) => !palette.has(pt.type)).map((pt) => pt.type))];
        if (extra.length) p.push(`The reference uses parts outside the palette: ${extra.join(', ')}.`);
        if (chipCycle && sol.board.parts.some((pt) => pt.type === 'chip')) p.push('A custom chip in the pack contains itself.');
      }
    }
    for (const r of l.requires) if (!ids.has(r) && !builtinIds.has(r)) p.push(`Requires an unknown level: ${r}.`);
  }
  // Requirement cycles inside the pack can never unlock.
  const state = new Map<string, 1 | 2>();
  const byId = new Map(pack.levels.map((l) => [l.id, l]));
  const visit = (id: string, stack: string[]): void => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) {
      for (const c of stack.slice(stack.indexOf(id))) out.get(c)?.push('Its requirements form a loop, so it never unlocks.');
      return;
    }
    state.set(id, 1);
    for (const r of byId.get(id)?.requires ?? []) if (byId.has(r)) visit(r, [...stack, id]);
    state.set(id, 2);
  };
  for (const l of pack.levels) visit(l.id, []);
  for (const [k, v] of out) out.set(k, [...new Set(v)]);
  return out;
}

/** Fail levels that require a failed pack level, until nothing changes. Pure; mutates `reports`. */
export function cascade(pack: LevelPack, reports: LevelReport[]): void {
  const byId = new Map(reports.map((r) => [r.id, r]));
  for (let changed = true; changed; ) {
    changed = false;
    for (const l of pack.levels) {
      const r = byId.get(l.id)!;
      if (!r.ok) continue;
      const bad = l.requires.find((q) => byId.get(q)?.ok === false);
      if (bad) {
        r.ok = false;
        r.problems.push(`Requires "${byId.get(bad)!.title}", which did not pass.`);
        changed = true;
      }
    }
  }
}

/**
 * Content-check a pack: static rules, then the reference must pass and the
 * empty starter must fail (run on `host`, the check worker).
 */
export async function validatePack(
  pack: LevelPack,
  host: CheckHost,
  builtinIds: ReadonlySet<string>,
  opts: { wrap?: Wrap; onProgress?: (done: number, total: number) => void } = {},
): Promise<PackReport> {
  const slug = packSlug(pack);
  const issues = staticIssues(pack, builtinIds);
  const reports: LevelReport[] = [];
  let done = 0;
  for (const l of pack.levels) {
    const problems = [...(issues.get(l.id) ?? [])];
    if (!problems.length) {
      const sol = pack.solutions[l.id]!;
      try {
        const c = await checkLevel(host, l, hasBoard(sol) ? { board: sol.board } : { source: hasSource(sol) ? sol.source : '' }, pack.chips, opts.wrap);
        if (c.problem) problems.push(c.problem);
      } catch (e) {
        problems.push(`The check failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    reports.push({ id: l.id, installId: namespacedId(slug, l.id), title: l.title, ok: problems.length === 0, problems });
    opts.onProgress?.(++done, pack.levels.length);
  }
  cascade(pack, reports);
  return { slug, name: pack.name, levels: reports };
}

/** An installed pack: only its levels that passed, with namespaced ids. */
export interface InstalledPack {
  slug: string;
  name: string;
  author?: string;
  description?: string;
  installedAt: string;
  levels: Level[];
}

/** Rename a level into its pack's namespace; requirements on pack levels follow. Pure. */
export function namespaceLevel(level: Level, slug: string, packIds: ReadonlySet<string>): Level {
  return {
    ...level,
    id: namespacedId(slug, level.id),
    requires: level.requires.map((r) => (packIds.has(r) ? namespacedId(slug, r) : r)),
    draft: false,
  };
}

/** The installable part of a validated pack. Pure. */
export function toInstalled(pack: LevelPack, report: PackReport, now = new Date()): InstalledPack {
  const ok = new Set(report.levels.filter((r) => r.ok).map((r) => r.id));
  const ids = new Set(pack.levels.map((l) => l.id));
  return {
    slug: report.slug,
    name: pack.name,
    ...(pack.author ? { author: pack.author } : {}),
    ...(pack.description ? { description: pack.description } : {}),
    installedAt: now.toISOString(),
    levels: pack.levels.filter((l) => ok.has(l.id)).map((l, i) => ({ ...namespaceLevel(l, report.slug, ids), order: i + 1 })),
  };
}
