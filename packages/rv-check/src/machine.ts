/**
 * Shared machine setup for code levels: the test checker (`runRiscvTest`) and
 * the worker's debugger both build (see ./build) and start programs through
 * these helpers, so "what the test runs" and "what the debugger shows" are the
 * same machine.
 *
 * Conventions (also in docs/code-levels.md):
 * - Registers start at 0, except sp = RAM base + RAM size (one past the last
 *   byte; 16-byte aligned) and ra = EXIT_STUB_ADDR, a two-instruction stub in
 *   the boot ROM (`li a7, 93; ecall`), so `ret` from `_start` exits with a0.
 * - The program ends at `ebreak`, or at `ecall` with a7 = 93 (exit code in a0).
 */

import { disassembleWord } from '@build-a-computer/asm';
import { CAUSE, Machine, RAM_BASE, SECTOR_SIZE, asm } from '@build-a-computer/rv32';
import type { Level } from '@build-a-computer/schema';
import { type Program, type ProgramDiagnostic } from './build';

/** Default RAM size when a level has no `code` setup (matches CodeSetup's default). */
export const DEFAULT_RAM_SIZE = 1024 * 1024;
/** Boot-ROM address of the exit stub `li a7, 93; ecall`; the initial `ra` points here. */
export const EXIT_STUB_ADDR = 0x0000_0100;
/** The exit system call number (Linux RISC-V convention). */
export const SYS_EXIT = 93;

/** ABI register names, index = register number. */
export const ABI_NAMES = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
  's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11',
  't3', 't4', 't5', 't6',
] as const; // prettier-ignore

/** Register number for an ABI name (`a0`, `fp`, …) or `xN`; undefined when unknown. */
export function regIndex(name: string): number | undefined {
  const n = name.trim().toLowerCase();
  if (n === 'fp') return 8;
  const m = /^x([0-9]{1,2})$/.exec(n);
  if (m) {
    const i = Number(m[1]);
    return i < 32 ? i : undefined;
  }
  const i = (ABI_NAMES as readonly string[]).indexOf(n);
  return i >= 0 ? i : undefined;
}

/** A test or level problem the player cannot fix (bad register name, poke outside memory). */
export class SetupError extends Error {}

/** Parse a hex byte string ("01 02 ff", "0102ff", "0x01,0x02"). */
export function parseHex(hex: string): Uint8Array {
  const clean = hex.replace(/0x/gi, '').replace(/[\s,_]/g, '');
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0)
    throw new SetupError(`bad hex bytes "${hex.slice(0, 40)}"`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export const hex32 = (v: number): string => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;

/** What a test (or the debugger) sets before the first instruction. */
export interface RunSetup {
  regs?: Record<string, number>;
  memory?: { addr: number; hex: string }[];
  /** Bytes written to the disk from a sector (needs the level's 'disk' device). */
  disk?: { sector: number; hex: string }[];
}

export interface CreateOptions {
  /** Called for every byte the program writes to the UART. */
  onUartTx?: (byte: number) => void;
}

/** Blank disk for code levels with the 'disk' device: 1 MiB = 2,048 sectors of 512 bytes. */
export const DISK_SIZE = 1024 * 1024;

/** The level's disk with the test's sectors written, or undefined without the 'disk' device. */
function makeDisk(level: Level, setup: RunSetup): Uint8Array | undefined {
  const writes = setup.disk ?? [];
  if (!level.code?.devices.includes('disk')) {
    if (writes.length)
      throw new SetupError("The test puts data on the disk, but the level has no 'disk' device.");
    return undefined;
  }
  const disk = new Uint8Array(DISK_SIZE);
  for (const w of writes) {
    const bytes = parseHex(w.hex);
    const at = w.sector * SECTOR_SIZE;
    if (!Number.isInteger(w.sector) || w.sector < 0 || at + bytes.length > DISK_SIZE)
      throw new SetupError(
        `The test writes ${bytes.length} bytes at disk sector ${w.sector}, past the end of the disk (${DISK_SIZE / SECTOR_SIZE} sectors of ${SECTOR_SIZE} bytes).`,
      );
    disk.set(bytes, at);
  }
  return disk;
}

/**
 * Create a machine, load the program's image at the RAM base (bss is zero:
 * RAM starts zeroed), set pc/sp/ra, apply `setup` (registers, memory pokes,
 * disk sectors), and install the stop hook. Throws SetupError when the
 * program does not fit in RAM or the setup is bad. A program that did not
 * build (`ok` false) loads nothing; callers check `ok` first.
 */
export function createMachine(
  program: Program,
  level: Level,
  setup: RunSetup = {},
  opts: CreateOptions = {},
): Machine {
  const link = program.link;
  const ramSize = level.code?.ramSize ?? DEFAULT_RAM_SIZE;
  const needed = link.end - RAM_BASE;
  if (needed > ramSize)
    throw new SetupError(`The program needs ${needed} bytes but RAM is only ${ramSize} bytes.`);
  // Levels that list the block device get a 1 MiB disk (with the test's sectors); others have none.
  const disk = makeDisk(level, setup);
  const m = new Machine({
    ramSize,
    ...(disk ? { disk } : {}),
    ...(opts.onUartTx ? { onUartTx: opts.onUartTx } : {}),
  });
  const stub = new Uint8Array(new Uint32Array([asm('addi', 17, 0, SYS_EXIT), asm('ecall')]).buffer);
  m.loadRom(stub, EXIT_STUB_ADDR);
  if (link.image.length) m.load(RAM_BASE, link.image);
  const h = m.hart;
  h.pc = program.entry;
  h.x[2] = (RAM_BASE + ramSize) | 0;
  h.x[1] = EXIT_STUB_ADDR;
  for (const [name, value] of Object.entries(setup.regs ?? {})) {
    const i = regIndex(name);
    if (i === undefined) throw new SetupError(`The test sets an unknown register "${name}".`);
    if (i !== 0) h.x[i] = value | 0;
  }
  for (const poke of setup.memory ?? []) {
    const bytes = parseHex(poke.hex);
    try {
      m.load(poke.addr, bytes);
    } catch {
      throw new SetupError(
        `The test writes ${bytes.length} bytes at ${hex32(poke.addr)}, which is not memory.`,
      );
    }
  }
  installStopHook(m);
  return m;
}

/** Why a program stopped on its own. */
export type StopEvent =
  | { kind: 'ebreak'; pc: number }
  | { kind: 'exit'; pc: number; code: number }
  | { kind: 'trap'; pc: number; cause: number; tval: number };

/** The stop event recorded by each machine's trap hook, read by `runMachine`. */
const pendingStop = new WeakMap<Machine, StopEvent>();

const ECALLS: readonly number[] = [CAUSE.ecallU, CAUSE.ecallS, CAUSE.ecallM];

/** True when a trap with this exception code, taken now, reaches a handler (mtvec/stvec set). */
function hasHandler(m: Machine, code: number): boolean {
  const h = m.hart;
  const toS = h.priv <= 1 && ((h.medeleg >>> code) & 1) !== 0;
  return ((toS ? h.stvec : h.mtvec) & ~3) !== 0;
}

/**
 * Install the hart's trap hook so the program stops (instead of trapping) on:
 * - `ebreak`, always;
 * - `ecall` with a7 = 93 (exit, a0 = exit code) from M-mode, or from S/U mode
 *   when no handler would receive it;
 * - any other exception with no handler installed (vector 0).
 * Interrupts and handled exceptions are taken normally. On a stop, pc is left
 * at the instruction that stopped and `runMachine` reports the event.
 */
export function installStopHook(m: Machine): void {
  m.hart.onTrap = (cause, tval, epc) => {
    if (cause >>> 31 !== 0) return 'take';
    const code = cause & 0x7fffffff;
    const pc = epc >>> 0;
    let ev: StopEvent | undefined;
    if (code === CAUSE.breakpoint) ev = { kind: 'ebreak', pc };
    else if (
      ECALLS.includes(code) &&
      m.hart.reg(17) === SYS_EXIT &&
      (code === CAUSE.ecallM || !hasHandler(m, code))
    )
      ev = { kind: 'exit', pc, code: m.hart.reg(10) };
    else if (!hasHandler(m, code)) ev = { kind: 'trap', pc, cause: code, tval: tval >>> 0 };
    if (!ev) return 'take';
    pendingStop.set(m, ev);
    return 'stop';
  };
}

export interface RunOutcome {
  /** Steps taken (instructions plus traps), from the hart's cycle counter. */
  steps: number;
  /** 'stopped' when `stop` is set; 'wfi' when parked with nothing to wake it. */
  reason: 'budget' | 'wfi' | 'stopped';
  stop?: StopEvent;
}

/** Run up to `steps` steps; a stop from the trap hook ends the run with its event. */
export function runMachine(m: Machine, steps: number): RunOutcome {
  const before = m.hart.cycles;
  const r = m.run(steps);
  const ran = m.hart.cycles - before;
  if (r.reason === 'stopped') {
    const stop = pendingStop.get(m);
    pendingStop.delete(m);
    if (stop) return { steps: ran, reason: 'stopped', stop };
  }
  return { steps: ran, reason: r.reason === 'wfi' ? 'wfi' : 'budget' };
}

/**
 * "line 12" in the player's file, "lib.s line 3" in another file, else the
 * address (with the function holding it when known). C programs cite C lines.
 */
export function where(program: Program, pc: number): string {
  const loc = program.locate(pc);
  if (loc)
    return loc.file === program.mainFile ? `line ${loc.line}` : `${loc.file} line ${loc.line}`;
  const fn = program.functionAt(pc);
  return fn ? `address ${hex32(pc)} (in ${fn})` : `address ${hex32(pc)}`;
}

/** True when pc is past the program's code (e.g. it ran off the end into zeroed RAM). */
function pastCode(program: Program, pc: number): boolean {
  const a = pc >>> 0;
  return (
    !program.link.sourceMap.some((e) => a >= e.address && a < e.address + e.size) &&
    a >= RAM_BASE &&
    a < RAM_BASE + 0x4000000
  );
}

/** How to end a program, in the level's language. */
export function exitHint(program: Pick<Program, 'language'>): string {
  return program.language === 'c'
    ? 'return from main (or call exit) where the program should end'
    : 'end the program with ebreak, or with li a7, 93 then ecall';
}

/** Plain-English explanation of an unhandled trap (E-CPU-05/07/08/09). */
export function trapMessage(
  m: Machine,
  program: Program,
  ev: Extract<StopEvent, { kind: 'trap' }>,
): string {
  const at = where(program, ev.pc);
  const word = m.hart.physRead(ev.pc | 0, 4);
  const instr = word === undefined ? '' : ` (${disassembleWord(word, ev.pc).text})`;
  const addr = hex32(ev.tval);
  const isC = program.language === 'c';
  switch (ev.cause) {
    case CAUSE.illegalInstruction:
      if (ev.tval === 0 && pastCode(program, ev.pc))
        return `The program ran past the end of its code into empty memory at ${hex32(ev.pc)} (illegal instruction 0x00000000). Did you forget to stop? ${capital(exitHint(program))}.`;
      return `Illegal instruction ${addr} at ${at} (pc ${hex32(ev.pc)}): the CPU cannot run that word.`;
    case CAUSE.instMisaligned:
      return `A jump or branch at ${at} went to ${addr}, which is not a multiple of 4 (instruction address misaligned).`;
    case CAUSE.instAccessFault:
      return `The program jumped to ${addr}, where there is no code to run (instruction access fault).`;
    case CAUSE.loadMisaligned:
      return `Misaligned load at ${at}${instr}: address ${addr} is not a multiple of the access size.`;
    case CAUSE.storeMisaligned:
      return `Misaligned store at ${at}${instr}: address ${addr} is not a multiple of the access size.`;
    case CAUSE.loadAccessFault:
      return `Load access fault at ${at}${instr}: nothing is mapped at address ${addr} (see the memory map).`;
    case CAUSE.storeAccessFault:
      return `Store access fault at ${at}${instr}: address ${addr} cannot be written (nothing there, or read-only).${isC && ev.tval < 0x1000 ? ' Is it a null pointer?' : ''}`;
    case CAUSE.ecallU:
    case CAUSE.ecallS:
    case CAUSE.ecallM:
      return `ecall at ${at} with a7 = ${m.hart.reg(17)}: no trap handler is installed, and the only built-in call is exit (a7 = 93).`;
    case CAUSE.instPageFault:
      return `Instruction page fault: address ${addr} is not mapped as executable.`;
    case CAUSE.loadPageFault:
      return `Load page fault at ${at}${instr}: address ${addr} is not mapped readable.`;
    case CAUSE.storePageFault:
      return `Store page fault at ${at}${instr}: address ${addr} is not mapped writable.`;
    default:
      return `Trap with cause ${ev.cause} at ${at} (mtval ${addr}) and no handler installed.`;
  }
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Formats a diagnostic as `main.s:3:5: message`. */
export const formatDiag = (d: ProgramDiagnostic): string =>
  `${d.file}:${d.line}:${d.column}: ${d.message}`;
