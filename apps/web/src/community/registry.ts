/**
 * Installed community packs on this device (COM-03). Levels are looked up by
 * persistence like built-in ones; progress is tracked under their namespaced
 * ids (`pack-<slug>--<id>`), so it travels in the workspace file too.
 */
import { create } from 'zustand';
import { Level } from '@build-a-computer/schema';
import { communityDb, communityWrite } from './db';
import type { InstalledPack } from './packs';

interface Registry {
  packs: InstalledPack[];
}

export const useCommunity = create<Registry>()(() => ({ packs: [] }));

/** Validate a stored pack record (never throws). */
export function decodeInstalled(raw: unknown, key: string): InstalledPack | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.slug !== key || typeof r.name !== 'string' || !Array.isArray(r.levels) || typeof r.installedAt !== 'string') return null;
  const levels: Level[] = [];
  for (const l of r.levels) {
    const p = Level.safeParse(l);
    if (p.success) levels.push(p.data);
  }
  return {
    slug: key,
    name: r.name,
    ...(typeof r.author === 'string' ? { author: r.author } : {}),
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
    installedAt: r.installedAt,
    levels,
  };
}

let loading: Promise<void> | null = null;

/** Load installed packs once (persistence awaits this before opening a level). */
export function loadCommunity(): Promise<void> {
  loading ??= communityDb()
    .then((s) => s.all('packs'))
    .then((rows) => {
      const packs: InstalledPack[] = [];
      for (const [k, v] of rows) {
        const p = decodeInstalled(v, k);
        if (p) packs.push(p);
      }
      packs.sort((a, b) => a.name.localeCompare(b.name));
      useCommunity.setState({ packs });
    })
    .catch((e: unknown) => console.error(e));
  return loading;
}

export const communityLevels = (): Level[] => useCommunity.getState().packs.flatMap((p) => p.levels);

export const communityLevelById = (id: string): Level | undefined => {
  if (!id.startsWith('pack-')) return undefined;
  for (const p of useCommunity.getState().packs) {
    const l = p.levels.find((x) => x.id === id);
    if (l) return l;
  }
  return undefined;
};

export const packOfLevel = (id: string): InstalledPack | undefined => useCommunity.getState().packs.find((p) => p.levels.some((l) => l.id === id));

/** The pack level after `id`, in pack order. */
export function nextPackLevel(id: string): Level | undefined {
  const p = packOfLevel(id);
  if (!p) return undefined;
  const i = p.levels.findIndex((l) => l.id === id);
  return p.levels[i + 1];
}

/** Install (or replace, same slug) a pack. */
export async function installPack(pack: InstalledPack): Promise<void> {
  await loadCommunity();
  useCommunity.setState((s) => ({ packs: [...s.packs.filter((p) => p.slug !== pack.slug), pack].sort((a, b) => a.name.localeCompare(b.name)) }));
  await communityWrite((s) => s.put('packs', pack.slug, pack));
}

/** Remove a pack. Saves and progress for its levels stay (re-importing brings them back). */
export async function removePack(slug: string): Promise<void> {
  useCommunity.setState((s) => ({ packs: s.packs.filter((p) => p.slug !== slug) }));
  await communityWrite((s) => s.remove('packs', slug));
}
