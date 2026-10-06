/**
 * OS-05: Sv32 page tables as data. Enumerate every mapping of a two-level
 * table (pure, over page-table words already read from memory), merge them
 * into contiguous ranges, and name their flags. The translate box asks the
 * worker (rvTranslate), which follows the emulator's own walk.
 */

export const PTE = { V: 0x1, R: 0x2, W: 0x4, X: 0x8, U: 0x10, G: 0x20, A: 0x40, D: 0x80 } as const;
/** The kernel's software bit (exec.c PTE_OWNED): kalloc gave the page to the process. */
export const PTE_OWNED_DEFAULT = 0x100;
export const PAGE = 4096;
export const MEGAPAGE = 4096 * 1024;

/** One leaf entry: a page (level 0) or a 4 MiB superpage (level 1). */
export interface Leaf {
  va: number;
  pa: number;
  pte: number;
  level: 0 | 1;
  /** Physical address of the PTE itself. */
  pteAddr: number;
}

/** A level-1 entry that points to a leaf table. */
export interface Branch {
  vpn1: number;
  pte: number;
  /** Physical address of the leaf table. */
  table: number;
  /** Valid leaves in it. */
  leaves: number;
}

export interface WalkResult {
  root: number;
  branches: Branch[];
  leaves: Leaf[];
  /** Physical addresses of every table page: the root, then each leaf table. */
  tables: number[];
  /** Entries that are V but malformed (W without R, or a non-leaf at level 0). */
  bad: { pteAddr: number; pte: number; level: 0 | 1 }[];
}

/** The page-table root from satp (MODE bit set), or null when paging is off. */
export const satpRoot = (satp: number): number | null => ((satp >>> 0) & 0x8000_0000 ? ((satp & 0x3fffff) * PAGE) >>> 0 : null);

const isLeaf = (pte: number): boolean => (pte & (PTE.R | PTE.X)) !== 0;
const isBad = (pte: number): boolean => (pte & PTE.W) !== 0 && (pte & PTE.R) === 0;
const ppnPa = (pte: number): number => ((pte >>> 10) * PAGE) >>> 0;

/**
 * Valid level-1 entries of `root` that point to leaf tables: the tables to
 * read before walkTables can see their leaves.
 */
export function branchTables(root: Uint32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < 1024; i++) {
    const pte = root[i] ?? 0;
    if (pte & PTE.V && !isLeaf(pte) && !isBad(pte)) out.push(ppnPa(pte));
  }
  return out;
}

/**
 * Every valid mapping of the table at `rootPa`. `root` holds its 1024 words;
 * `tables` the words of each leaf table by physical address (a missing table
 * counts as unreadable and is skipped).
 */
export function walkTables(rootPa: number, root: Uint32Array, tables: ReadonlyMap<number, Uint32Array>): WalkResult {
  const res: WalkResult = { root: rootPa >>> 0, branches: [], leaves: [], tables: [rootPa >>> 0], bad: [] };
  for (let i = 0; i < 1024; i++) {
    const pte = (root[i] ?? 0) >>> 0;
    if (!(pte & PTE.V)) continue;
    const pteAddr = (rootPa + i * 4) >>> 0;
    if (isBad(pte)) {
      res.bad.push({ pteAddr, pte, level: 1 });
      continue;
    }
    if (isLeaf(pte)) {
      res.leaves.push({ va: (i * MEGAPAGE) >>> 0, pa: ((pte >>> 20) * MEGAPAGE) >>> 0, pte, level: 1, pteAddr });
      continue;
    }
    const table = ppnPa(pte);
    const words = tables.get(table);
    const branch: Branch = { vpn1: i, pte, table, leaves: 0 };
    res.branches.push(branch);
    res.tables.push(table);
    if (!words) continue;
    for (let j = 0; j < 1024; j++) {
      const leaf = (words[j] ?? 0) >>> 0;
      if (!(leaf & PTE.V)) continue;
      const at = (table + j * 4) >>> 0;
      if (isBad(leaf) || !isLeaf(leaf)) {
        res.bad.push({ pteAddr: at, pte: leaf, level: 0 });
        continue;
      }
      branch.leaves++;
      res.leaves.push({ va: ((i << 22) | (j << 12)) >>> 0, pa: ppnPa(leaf), pte: leaf, level: 0, pteAddr: at });
    }
  }
  return res;
}

/** A run of mappings with the same flags, contiguous in both virtual and physical memory. */
export interface Range {
  va: number;
  pa: number;
  /** Bytes mapped. */
  size: number;
  /** Pages (4 KiB) or superpages in the run. */
  count: number;
  level: 0 | 1;
  /** The low 10 bits of the PTEs (flags and software bits). */
  flags: number;
}

/** Merge leaves (any order) into ranges: same level and flags, VA and PA both continuing. */
export function mergeRanges(leaves: readonly Leaf[]): Range[] {
  const sorted = [...leaves].sort((a, b) => a.va - b.va);
  const out: Range[] = [];
  for (const l of sorted) {
    const size = l.level === 1 ? MEGAPAGE : PAGE;
    const flags = l.pte & 0x3ff;
    const last = out[out.length - 1];
    if (last && last.level === l.level && last.flags === flags && last.va + last.size === l.va && last.pa + last.size === l.pa) {
      last.size += size;
      last.count++;
    } else out.push({ va: l.va, pa: l.pa, size, count: 1, level: l.level, flags });
  }
  return out;
}

/** Flags as the fixed-width letters D A G U X W R V ('-' when clear), most significant first. */
export function flagString(pte: number): string {
  const order: [keyof typeof PTE, number][] = [['D', PTE.D], ['A', PTE.A], ['G', PTE.G], ['U', PTE.U], ['X', PTE.X], ['W', PTE.W], ['R', PTE.R], ['V', PTE.V]];
  return order.map(([k, bit]) => (pte & bit ? k : '-')).join('');
}

/** The range holding `va`, if any. */
export const rangeAt = (ranges: readonly Range[], va: number): Range | undefined =>
  ranges.find((r) => va >>> 0 >= r.va && va >>> 0 < r.va + r.size);

/** True for instruction, load and store page faults (mcause 12, 13, 15). */
export const isPageFault = (cause: number): boolean => cause === 12 || cause === 13 || cause === 15;
