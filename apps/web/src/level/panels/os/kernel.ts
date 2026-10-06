/**
 * OS-05: the kernel's state as the panels show it, decoded from raw memory
 * with the layouts in the level's kernel.h (header.ts) and the addresses of
 * the kernel's symbols. Pure: the panels fetch the bytes (useKernel.ts).
 */

import { fieldOf, parseHeader, readField, readString, type KernelHeader, type StructLayout } from './header';
import { PAGE, PTE, PTE_OWNED_DEFAULT, type WalkResult } from './sv32';

/** Process states by kernel.h name, in the order docs/os.md lists them. */
export const STATE_NAMES = ['UNUSED', 'RUNNABLE', 'RUNNING', 'SLEEPING', 'WAITING', 'ZOMBIE'] as const;
export type StateName = (typeof STATE_NAMES)[number];

/** Where the kernel keeps what the panels read, and how it is laid out. */
export interface KernelModel {
  header: KernelHeader;
  proc?: StructLayout;
  trapframe?: StructLayout;
  nproc: number;
  /** State value -> kernel.h name. */
  states: ReadonlyMap<number, StateName>;
  symbols: Readonly<Record<string, number>>;
  ramBase: number;
  ramEnd: number;
  kstackTop: number;
  kstackSize: number;
  /** Where the kernel image starts (RAM_BASE, or where the bootloader put it). */
  kernelStart: number;
  kernelEnd?: number;
  pteOwned: number;
  /** The level has paging (struct proc has a page table). */
  vm: boolean;
  /** The level has the file system (struct superblock). */
  fs: boolean;
  timer: boolean;
}

/**
 * Build the model from kernel.h and the kernel's symbols; null without a
 * process table. Kernel levels link the kernel into the player's build (its
 * symbols, the image from RAM_BASE). Program levels run the disk kernel:
 * `disk` symbols from os-kit, the image from its `_start`, and the program
 * the bootloader loaded below it.
 */
export function kernelModel(headerText: string, build: Readonly<Record<string, number>>, disk: Readonly<Record<string, number>> = {}): KernelModel | null {
  const fromDisk = Object.keys(disk).length > 0;
  const symbols = fromDisk ? disk : build;
  const header = parseHeader(headerText);
  const d = header.defines;
  const proc = header.structs.get('proc');
  const states = new Map<number, StateName>();
  for (const n of STATE_NAMES) {
    const v = d.get(n);
    if (v !== undefined) states.set(v, n);
  }
  if (symbols['procs'] === undefined || !proc) return null;
  const ramBase = d.get('RAM_BASE') ?? 0x8000_0000;
  return {
    header,
    proc,
    ...(header.structs.get('trapframe') ? { trapframe: header.structs.get('trapframe')! } : {}),
    nproc: d.get('NPROC') ?? 8,
    states,
    symbols,
    ramBase,
    ramEnd: d.get('RAM_END') ?? ramBase + 0x40_0000,
    kstackTop: d.get('KSTACK_TOP') ?? d.get('RAM_END') ?? ramBase + 0x40_0000,
    kstackSize: d.get('KSTACK_SIZE') ?? 0x4000,
    kernelStart: (fromDisk ? symbols['_start'] : undefined) ?? ramBase,
    ...(symbols['kernel_end'] !== undefined ? { kernelEnd: symbols['kernel_end'] } : {}),
    pteOwned: d.get('PTE_OWNED') ?? PTE_OWNED_DEFAULT,
    vm: !!fieldOf(proc, 'pagetable'),
    fs: header.structs.has('superblock'),
    timer: !!fieldOf(proc, 'wake'),
  };
}

/** Symbols as a record (the debugger keeps a list). */
export const symbolRecord = (list: readonly { name: string; addr: number }[]): Record<string, number> =>
  Object.fromEntries(list.map((s) => [s.name, s.addr >>> 0]));

export interface ProcView {
  slot: number;
  /** Address of the struct (and of its trap frame, its first member). */
  addr: number;
  pid: number;
  state: number;
  stateName: StateName | undefined;
  exitcode: number;
  name: string;
  /** Saved registers (regs[0] unused) and resume pc, from the trap frame. */
  regs: number[];
  epc: number;
  kstack: number;
  wake?: number;
  parent?: number;
  pagetable?: number;
  heapEnd?: number;
  files?: { inum: number; off: number }[];
}

/** Decode the process table from `bytes`, read at `model.symbols.procs`. */
export function decodeProcs(model: KernelModel, bytes: Uint8Array): ProcView[] {
  const p = model.proc!;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = model.symbols['procs']!;
  const tfField = fieldOf(p, 'tf');
  const tf = model.trapframe;
  const regsF = fieldOf(tf, 'regs');
  const epcF = fieldOf(tf, 'epc');
  const kstackF = fieldOf(tf, 'kstack');
  const num = (o: number, name: string): number | undefined => {
    const f = fieldOf(p, name);
    return f ? readField(view, o, f) : undefined;
  };
  const out: ProcView[] = [];
  for (let slot = 0; slot < model.nproc; slot++) {
    const o = slot * p.size;
    if (o + p.size > bytes.length) break;
    const t = o + (tfField?.offset ?? 0);
    const state = num(o, 'state') ?? 0;
    const nameF = fieldOf(p, 'name');
    const v: ProcView = {
      slot,
      addr: (base + o) >>> 0,
      pid: num(o, 'pid') ?? 0,
      state,
      stateName: model.states.get(state),
      exitcode: num(o, 'exitcode') ?? 0,
      name: nameF ? readString(view, o, nameF) : '',
      regs: regsF ? Array.from({ length: regsF.count ?? 32 }, (_, i) => readField(view, t, regsF, i) >>> 0) : [],
      epc: epcF ? readField(view, t, epcF) >>> 0 : 0,
      kstack: kstackF ? readField(view, t, kstackF) >>> 0 : 0,
    };
    const wake = num(o, 'wake');
    if (wake !== undefined) v.wake = wake >>> 0;
    const parent = num(o, 'parent');
    if (parent !== undefined) v.parent = parent;
    const pt = num(o, 'pagetable');
    if (pt !== undefined) v.pagetable = pt >>> 0;
    const heap = num(o, 'heap_end');
    if (heap !== undefined) v.heapEnd = heap >>> 0;
    const files = fieldOf(p, 'files');
    const ofile = model.header.structs.get('ofile');
    if (files && ofile) {
      const inum = fieldOf(ofile, 'inum');
      const off = fieldOf(ofile, 'off');
      v.files = Array.from({ length: files.count ?? 1 }, (_, i) => {
        const at = o + files.offset + i * files.elemSize;
        return { inum: inum ? readField(view, at, inum) : 0, off: off ? readField(view, at, off) : 0 };
      });
    }
    out.push(v);
  }
  return out;
}

/** Slot of the process `current` points to, or -1. */
export function currentSlot(model: KernelModel, current: number): number {
  const base = model.symbols['procs'];
  const size = model.proc?.size ?? 0;
  if (base === undefined || !size || !current) return -1;
  const off = (current >>> 0) - base;
  return off >= 0 && off % size === 0 && off / size < model.nproc ? off / size : -1;
}

/**
 * Follow the allocator's free list: `head` is the first free page, and each
 * free page's first word points to the next (kalloc.c struct run).
 * `firstWords[i]` is the first word of page i of RAM. Stops at 0, a pointer
 * outside RAM or not page aligned (`broken`), or a loop.
 */
export function followFreeList(model: KernelModel, head: number, firstWords: Uint32Array): { pages: number[]; broken?: number; loop?: boolean } {
  const pages: number[] = [];
  const seen = new Set<number>();
  let p = head >>> 0;
  while (p) {
    if (p < model.ramBase || p >= model.ramEnd || p % PAGE) return { pages, broken: p };
    if (seen.has(p)) return { pages, loop: true };
    seen.add(p);
    pages.push(p);
    p = firstWords[(p - model.ramBase) / PAGE] ?? 0;
  }
  return { pages };
}

export type FrameKind = 'kernel' | 'loaded' | 'kstack' | 'free' | 'table' | 'user' | 'used' | 'unused';

export interface Frame {
  pa: number;
  kind: FrameKind;
  /** Owning process (table and user frames). */
  pid?: number;
  /** Also mapped (not owned) by these pids: the framebuffer, a program the bootloader loaded. */
  shared?: number[];
}

/**
 * Classify every 4 KiB frame of RAM: the kernel image, a program the
 * bootloader loaded below it, the kernel stack, free pages (on the free
 * list), page tables and pages each process owns, and pages the allocator
 * handed out that no page table holds (`used`: in flight, or leaked).
 */
export function classifyFrames(
  model: KernelModel,
  free: ReadonlySet<number>,
  spaces: readonly { pid: number; walk: WalkResult }[],
): Frame[] {
  const frames: Frame[] = [];
  const kernelEnd = Math.ceil((model.kernelEnd ?? model.kernelStart) / PAGE) * PAGE;
  const stackLo = model.kstackTop - model.kstackSize;
  const owner = new Map<number, { kind: 'table' | 'user'; pid: number }>();
  const shared = new Map<number, number[]>();
  for (const { pid, walk } of spaces) {
    for (const t of walk.tables) owner.set(t, { kind: 'table', pid });
    for (const l of walk.leaves) {
      if (l.level !== 0) continue;
      if (l.pte & model.pteOwned) owner.set(l.pa, { kind: 'user', pid });
      else if (l.pte & PTE.U) shared.set(l.pa, [...(shared.get(l.pa) ?? []), pid]);
    }
  }
  for (let pa = model.ramBase; pa < model.ramEnd; pa += PAGE) {
    let f: Frame;
    const own = owner.get(pa);
    if (pa >= model.kernelStart && pa < kernelEnd) f = { pa, kind: 'kernel' };
    else if (pa < model.kernelStart) f = { pa, kind: 'loaded' };
    else if (pa >= stackLo && pa < model.kstackTop) f = { pa, kind: 'kstack' };
    else if (free.has(pa)) f = { pa, kind: 'free' };
    else if (own) f = { pa, kind: own.kind, pid: own.pid };
    else f = { pa, kind: model.vm ? 'used' : 'unused' };
    const sh = shared.get(pa);
    if (sh) f.shared = sh;
    frames.push(f);
  }
  return frames;
}

/** Frame counts by kind. */
export function frameCounts(frames: readonly Frame[]): Record<FrameKind, number> {
  const c: Record<FrameKind, number> = { kernel: 0, loaded: 0, kstack: 0, free: 0, table: 0, user: 0, used: 0, unused: 0 };
  for (const f of frames) c[f.kind]++;
  return c;
}

export type RangeKind = 'code' | 'data' | 'stack' | 'guard' | 'framebuffer' | 'shared' | 'other';

/**
 * What a user mapping is, by docs/os.md's address-space layout (kernel.h
 * constants): code (X), data and heap, the stack, its guard page (no U), the
 * framebuffer, or memory the process maps but does not own.
 */
export function rangeKind(m: KernelModel, r: { va: number; size: number; flags: number }): RangeKind {
  const d = m.header.defines;
  const pg = d.get('PGSIZE') ?? PAGE;
  const top = d.get('USER_STACK_TOP');
  const stackLo = top !== undefined ? top - (d.get('USER_STACK_PAGES') ?? 2) * pg : undefined;
  if (d.get('USER_FB') !== undefined && r.va === d.get('USER_FB')) return 'framebuffer';
  if (!(r.flags & PTE.U)) return 'guard';
  if (top !== undefined && stackLo !== undefined && r.va >= stackLo && r.va < top) return 'stack';
  if (!(r.flags & m.pteOwned)) return 'shared';
  if (r.flags & PTE.X) return 'code';
  if (r.flags & PTE.W) return 'data';
  return 'other';
}
