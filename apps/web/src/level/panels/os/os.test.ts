/**
 * OS-05 acceptance: the panels' decoders match the kernel's state during
 * scripted runs of the reference kernels (the real pipeline: the worker's
 * RvHost, the levels' libraries and os-kit's disk kernel).
 */
import { describe, expect, it } from 'vitest';
import { SimHost, type RvSnapshot } from '@build-a-computer/worker';
import { osKernelInfo } from '@build-a-computer/content';
import { levelById } from '@build-a-computer/content/full';
import { referenceSource } from '@build-a-computer/content/solutions';
import { parseHeader } from './header';
import { kernelModel, symbolRecord, frameCounts, type KernelModel } from './kernel';
import { readKernel, type KernelIO } from './gather';
import { parseFs } from './fs';
import { mergeRanges, flagString, PTE, satpRoot, rangeAt } from './sv32';

async function boot(id: string, test?: number) {
  const level = levelById(id)!;
  const host = new SimHost(
    () => 0,
    () => 0 as unknown as ReturnType<typeof setTimeout>,
  );
  let last: RvSnapshot | null = null;
  host.rvSubscribe((s) => (last = s));
  const res = await host.rvLoad(referenceSource(level)!, level, test === undefined ? {} : { test });
  expect(res.ok).toBe(true);
  const info = (await osKernelInfo(id))!;
  const model = kernelModel(info.header, symbolRecord(res.symbols), info.symbols)!;
  expect(model).not.toBeNull();
  const io: KernelIO = { words: async (a, n, s) => host.rvReadWords(a, n, s), bytes: async (a, n) => host.rvMemory(a, n) };
  return { host, model, io, level, state: () => last!.state };
}

const OS_LEVELS = ['os-context-switch', 'os-preemption', 'os-virtual-memory', 'os-page-allocator', 'os-file-system', 'os-shell', 'os-final-game'];

describe('kernel.h layouts (data-driven from os-kit)', () => {
  it.each(OS_LEVELS)('%s: struct proc spans procs[] up to `current`, as the compiler laid it out', async (id) => {
    const info = (await osKernelInfo(id))!;
    const level = levelById(id)!;
    const host = new SimHost(
      () => 0,
      () => 0 as unknown as ReturnType<typeof setTimeout>,
    );
    const res = await host.rvLoad(referenceSource(level)!, level);
    const m = kernelModel(info.header, symbolRecord(res.symbols), info.symbols)!;
    // proc.c declares `current` right after `procs[NPROC]`.
    expect(m.symbols['current']! - m.symbols['procs']!).toBe(m.nproc * m.proc!.size);
    const tf = m.trapframe!;
    expect(tf.fields.map((f) => [f.name, f.offset])).toEqual([
      ['regs', 0],
      ['epc', 128],
      ['kstack', 132],
    ]);
  });

  it('the bootloader and the early kernels have no process table', async () => {
    expect(await osKernelInfo('os-bootloader')).toBeNull();
    const info = (await osKernelInfo('os-system-calls'))!;
    expect(kernelModel(info.header, {})).toBeNull();
    expect(parseHeader(info.header).structs.has('proc')).toBe(false);
  });
});

/** Step until `done` holds (in chunks), failing after `max` chunks. */
async function until(host: SimHost, model: KernelModel, io: KernelIO, done: (k: NonNullable<Awaited<ReturnType<typeof readKernel>>>) => boolean, chunk = 500, max = 4000) {
  for (let i = 0; i < max; i++) {
    host.rvStep(chunk);
    const k = (await readKernel(io, model))!;
    if (done(k)) return k;
  }
  throw new Error('condition never held');
}

/** Single-step until the machine state satisfies `done` (cheap: no memory reads). */
function stepUntil(host: SimHost, state: () => RvSnapshot['state'], done: (s: RvSnapshot['state']) => boolean, max = 1_000_000) {
  for (let i = 0; i < max; i++) {
    if (done(state())) return;
    host.rvStep(1);
  }
  throw new Error('state never reached');
}

describe('process table during a scripted run', () => {
  it('context switch: the running process is `current`, the others wait with their saved pc', async () => {
    const { host, model, io, state } = await boot('os-context-switch');
    const k = await until(host, model, io, (k) => k.procs.filter((p) => p.stateName === 'RUNNABLE').length >= 1 && state().mode === 'U');
    const running = k.procs.filter((p) => p.stateName === 'RUNNING');
    expect(running).toHaveLength(1);
    expect(running[0]!.slot).toBe(k.current);
    expect(k.procs.filter((p) => p.state).map((p) => [p.pid, p.name])).toEqual([
      [1, 'ping'],
      [2, 'pong'],
    ]);
    // In user mode mscratch holds the running process's trap frame: its proc.
    expect(state().csrs['mscratch']).toBe(running[0]!.addr);
    // A waiting process resumes where it trapped: inside the kernel image, past its user code.
    const waiting = k.procs.find((p) => p.stateName === 'RUNNABLE')!;
    expect(waiting.epc).toBeGreaterThanOrEqual(model.ramBase);
    expect(waiting.regs[2]).toBeGreaterThan(model.symbols['procs']!); // its own stack in ustacks[]
  });

  it('preemption: every process has a wake time field and the running one is current', async () => {
    const { host, model, io, state } = await boot('os-preemption');
    expect(model.timer).toBe(true);
    const k = await until(host, model, io, (k) => k.procs.filter((p) => p.state).length === 3 && state().mode === 'U');
    expect(k.procs.find((p) => p.slot === k.current)?.stateName).toBe('RUNNING');
    expect(k.procs.every((p) => p.wake !== undefined)).toBe(true);
  });
});

describe('page tables and physical memory during a scripted run', () => {
  it('page allocator: satp is the running process table; code, data, guard and stack as docs/os.md lays them out', async () => {
    const { host, model, io, state } = await boot('os-page-allocator');
    stepUntil(host, state, (s) => s.mode === 'U');
    const k = (await readKernel(io, model))!;
    const cur = k.procs[k.current]!;
    expect(satpRoot(state().csrs['satp']!)).toBe(cur.pagetable);
    const walk = k.spaces.get(cur.slot)!;
    const ranges = mergeRanges(walk.leaves);
    const d = model.header.defines;
    const code = rangeAt(ranges, d.get('USER_BASE')!)!;
    expect(flagString(code.flags)).toBe('DA-UX-RV');
    const guard = rangeAt(ranges, d.get('USER_GUARD')!)!;
    expect(guard.flags & PTE.U).toBe(0);
    const stack = rangeAt(ranges, d.get('USER_STACK_TOP')! - 4)!;
    expect(flagString(stack.flags)).toBe('DA-U-WRV');
    // The worker's MMU probe agrees with the walk, and the guard page faults from user mode.
    const tr = host.rvTranslate(d.get('USER_BASE')! + 0x24)!;
    expect(tr.ok).toBe(true);
    expect(tr.pa).toBe(code.pa + 0x24);
    const g = host.rvTranslate(d.get('USER_GUARD')!, undefined, 'store')!;
    expect([g.ok, g.cause, g.why]).toEqual([false, 15, 'notUser']);
    // The free list has exactly the allocator's count; the process owns its tables and pages.
    expect(k.free!.pages.length).toBe(k.nfree);
    const c = frameCounts(k.frames!);
    expect(c.free).toBe(k.nfree);
    expect(c.table).toBe(3);
    expect(k.frames!.filter((f) => f.pid === cur.pid && f.kind === 'user').length).toBe(walk.leaves.filter((l) => l.pte & model.pteOwned).length);
    expect(c.kernel).toBe(Math.ceil((model.kernelEnd! - model.ramBase) / 4096));
    expect(c.kstack).toBe(model.kstackSize / 4096);
  });

  it('virtual memory: a faulting program leaves mcause/mtval for the panel to point at', async () => {
    const level = levelById('os-virtual-memory')!;
    const nullread = level.tests.findIndex((t) => 'name' in t && /null/i.test(String(t.name)));
    expect(nullread).toBeGreaterThanOrEqual(0);
    const { host, state } = await boot('os-virtual-memory', nullread);
    stepUntil(host, state, (s) => s.csrs['mcause'] === 13);
    expect(state().csrs['mtval']).toBe(0);
    expect(host.rvTranslate(state().csrs['mtval']!)!.ok).toBe(false);
  });

  it('program levels: the disk kernel above the program the bootloader loaded', async () => {
    const { host, model, io } = await boot('os-shell', 0);
    expect(model.kernelStart).toBe(0x8020_0000);
    const k = await until(host, model, io, (k) => k.current >= 0, 100_000, 100);
    const c = frameCounts(k.frames!);
    expect(c.loaded).toBe(512);
    expect(c.kernel).toBe(Math.ceil((model.kernelEnd! - model.kernelStart) / 4096));
    expect(c.free).toBe(k.nfree);
  });
});

describe('file system view', () => {
  it('reads the superblock, inodes and the root directory from the disk', async () => {
    const level = levelById('os-file-system')!;
    const header = parseHeader((await osKernelInfo('os-file-system'))!.header);
    let seen = false;
    for (let i = 0; i < level.tests.length && !seen; i++) {
      if (level.tests[i]!.kind !== 'riscv') continue;
      const { host } = await boot('os-file-system', i);
      const fs = parseFs(header, host.rvDisk(0, 2048));
      if (!fs.root.some((e) => e.name === 'big.txt')) continue;
      seen = true;
      expect(fs.sb!.ninodes).toBe(32);
      expect(fs.root.map((e) => e.name)).toEqual(expect.arrayContaining(['init', 'readme.txt', 'hello', 'big.txt']));
      expect(fs.root.find((e) => e.name === 'readme.txt')!.size).toBe(67);
      const big = fs.inodes.find((n) => n.inum === fs.root.find((e) => e.name === 'big.txt')!.inum)!;
      expect(big.indirect).toBeDefined();
      expect(big.sectors).toHaveLength(Math.ceil(big.size / 512));
    }
    expect(seen).toBe(true);
  });

  it('a blank disk has no file system', () => {
    const header = parseHeader('');
    expect(parseFs(header, new Uint8Array(0)).problem).toBe('empty');
    expect(parseFs(header, new Uint8Array(1024)).problem).toBe('noMagic');
  });
});
