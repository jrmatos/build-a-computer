/**
 * OS-05: read the kernel's state out of the machine in a few batched worker
 * calls (the process table, the first word of every page for the free list,
 * each address space's page tables) and decode it with kernel.ts / sv32.ts.
 */

import { classifyFrames, currentSlot, decodeProcs, followFreeList, type Frame, type KernelModel, type ProcView } from './kernel';
import { branchTables, PAGE, walkTables, type WalkResult } from './sv32';

/** Physical memory as the worker serves it (rv.readWords / rv.memory, or a SimHost in tests). */
export interface KernelIO {
  words(addr: number, count: number, stride?: number): Promise<Uint32Array | undefined>;
  bytes(addr: number, length: number): Promise<Uint8Array | undefined>;
}

export interface KernelSnapshot {
  procs: ProcView[];
  /** Slot `current` points to, or -1. */
  current: number;
  ticks?: number;
  /** The allocator's own count (kalloc.c nfree). */
  nfree?: number;
  /** Pages on the free list, and where it went wrong when it did. */
  free?: { pages: number[]; broken?: number; loop?: boolean };
  /** Page tables of each process that has one, by slot. */
  spaces: Map<number, WalkResult>;
  frames?: Frame[];
}

/** Read and walk the page table rooted at `root` (physical). */
export async function readSpace(io: KernelIO, root: number): Promise<WalkResult | undefined> {
  const words = await io.words(root, 1024);
  if (!words) return undefined;
  const tables = new Map<number, Uint32Array>();
  const need = branchTables(words);
  const got = await Promise.all(need.map((t) => io.words(t, 1024)));
  need.forEach((t, i) => {
    const w = got[i];
    if (w) tables.set(t, w);
  });
  return walkTables(root, words, tables);
}

const inRam = (m: KernelModel, pa: number): boolean => pa >= m.ramBase && pa + PAGE <= m.ramEnd && pa % PAGE === 0;

/** Everything the panels show, read at one moment. */
export async function readKernel(io: KernelIO, m: KernelModel): Promise<KernelSnapshot | undefined> {
  const procsAt = m.symbols['procs']!;
  const scalars = ['current', 'ticks', 'freelist', 'nfree'] as const;
  const [table, ...vals] = await Promise.all([
    io.bytes(procsAt, m.nproc * (m.proc?.size ?? 0)),
    ...scalars.map((s) => (m.symbols[s] !== undefined ? io.words(m.symbols[s]!, 1) : Promise.resolve(undefined))),
  ]);
  if (!table) return undefined;
  const val = (s: (typeof scalars)[number]): number | undefined => vals[scalars.indexOf(s)]?.[0];
  const procs = decodeProcs(m, table as Uint8Array);
  const snap: KernelSnapshot = { procs, current: currentSlot(m, val('current') ?? 0), spaces: new Map() };
  const ticks = val('ticks');
  if (ticks !== undefined) snap.ticks = ticks;
  if (!m.vm) return snap;

  const nfree = val('nfree');
  if (nfree !== undefined) snap.nfree = nfree;
  // Any slot with a page table: a process being built (spawn) is still UNUSED.
  const live = procs.filter((p) => p.pagetable && inRam(m, p.pagetable));
  const [firstWords, ...walks] = await Promise.all([
    m.symbols['freelist'] !== undefined ? io.words(m.ramBase, (m.ramEnd - m.ramBase) / PAGE, PAGE) : Promise.resolve(undefined),
    ...live.map((p) => readSpace(io, p.pagetable!)),
  ]);
  live.forEach((p, i) => {
    const w = walks[i];
    if (w) snap.spaces.set(p.slot, w);
  });
  const head = val('freelist');
  if (firstWords && head !== undefined) snap.free = followFreeList(m, head, firstWords);
  snap.frames = classifyFrames(
    m,
    new Set(snap.free?.pages ?? []),
    live.flatMap((p) => (snap.spaces.has(p.slot) ? [{ pid: p.pid, walk: snap.spaces.get(p.slot)! }] : [])),
  );
  return snap;
}
