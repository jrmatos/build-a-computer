/**
 * Shared machine setup for code levels: the test checker (`runRiscvTest`) and
 * the worker's debugger both build and start programs through these helpers,
 * so "what the test runs" and "what the debugger shows" are the same machine.
 *
 * Conventions (also in docs/code-levels.md):
 * - The player's file is `main.s`; level library files are assembled after it
 *   and linked into one flat image at the RAM base 0x8000_0000.
 * - Entry: `_start` when defined, else the first byte of `.text` (the RAM base).
 * - Registers start at 0, except sp = RAM base + RAM size (one past the last
 *   byte; 16-byte aligned) and ra = EXIT_STUB_ADDR, a two-instruction stub in
 *   the boot ROM (`li a7, 93; ecall`), so `ret` from `_start` exits with a0.
 * - The program ends at `ebreak`, or at `ecall` with a7 = 93 (exit code in a0).
 */

import {
  type Diagnostic,
  type LinkResult,
  type SourceFile,
  build,
  disassembleWord,
  lineForAddress,
} from '@build-a-computer/asm';
import { CAUSE, Machine, RAM_BASE, asm } from '@build-a-computer/rv32';
import type { Level } from '@build-a-computer/schema';

/** The player's file name in diagnostics and the source map. */
export const MAIN_FILE = 'main.s';
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

/** Assemble `main.s` plus the level's library files and link them at the RAM base. */
export function buildProgram(source: string, level: Level): LinkResult {
  const files: SourceFile[] = [
    { name: MAIN_FILE, text: source },
    ...(level.code?.library ?? []).map((f) => ({ name: f.name, text: f.text })),
  ];
  return build(files, { base: RAM_BASE });
}

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
}

export interface CreateOptions {
  /** Called for every byte the program writes to the UART. */
  onUartTx?: (byte: number) => void;
}

/**
 * Create a machine, load the linked image at the RAM base (bss is zero: RAM
 * starts zeroed), set pc/sp/ra, apply `setup`, and install the stop hook.
 * Throws SetupError when the program does not fit in RAM or the setup is bad.
 */
/** Blank disk for code levels with the 'disk' device: 1 MiB = 2,048 sectors of 512 bytes. */
export const DISK_SIZE = 1024 * 1024;

export function createMachine(
  link: LinkResult,
  level: Level,
  setup: RunSetup = {},
  opts: CreateOptions = {},
): Machine {
  const ramSize = level.code?.ramSize ?? DEFAULT_RAM_SIZE;
  const needed = link.end - RAM_BASE;
  if (needed > ramSize)
    throw new SetupError(`The program needs ${needed} bytes but RAM is only ${ramSize} bytes.`);
  // Levels that list the block device get a blank disk (Phase 7); others have none.
  const disk = level.code?.devices.includes('disk') ? new Uint8Array(DISK_SIZE) : undefined;
  const m = new Machine({ ramSize, ...(disk ? { disk } : {}), ...(opts.onUartTx ? { onUartTx: opts.onUartTx } : {}) });
  const stub = new Uint8Array(new Uint32Array([asm('addi', 17, 0, SYS_EXIT), asm('ecall')]).buffer);
  m.loadRom(stub, EXIT_STUB_ADDR);
  if (link.image.length) m.load(RAM_BASE, link.image);
  const h = m.hart;
  h.pc = link.entry;
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
      throw new SetupError(`The test writes ${bytes.length} bytes at ${hex32(poke.addr)}, which is not memory.`);
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

/** Thrown out of `Hart.run` by the stop hook; `runMachine` catches it. */
export class StopSignal {
  constructor(readonly event: StopEvent) {}
}

const ECALLS: readonly number[] = [CAUSE.ecallU, CAUSE.ecallS, CAUSE.ecallM];

/** True when a trap with this exception code, taken now, reaches a handler (mtvec/stvec set). */
function hasHandler(m: Machine, code: number): boolean {
  const h = m.hart;
  const toS = h.priv <= 1 && ((h.medeleg >>> code) & 1) !== 0;
  return ((toS ? h.stvec : h.mtvec) & ~3) !== 0;
}

/**
 * Intercept traps before the hart takes them (the hart has no public hook, so
 * this wraps its private `takeTrap` on this instance only):
 * - `ebreak` always stops the program;
 * - `ecall` with a7 = 93 exits (a0 = exit code) from M-mode, or from S/U mode
 *   when no handler would receive it;
 * - any other exception with no handler installed (vector 0) stops with a trap.
 * Interrupts and handled exceptions go through unchanged.
 * On a stop, pc is left at the instruction that stopped.
 */
export function installStopHook(m: Machine): void {
  const hart = m.hart as unknown as { takeTrap(cause: number, tval: number, epc: number): void };
  const orig = hart.takeTrap.bind(hart);
  hart.takeTrap = (cause: number, tval: number, epc: number): void => {
    if (cause >>> 31 === 0) {
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
      if (ev) {
        m.hart.pc = pc;
        m.hart.waiting = false;
        throw new StopSignal(ev);
      }
    }
    orig(cause, tval, epc);
  };
}

export interface RunOutcome {
  /** Steps taken (instructions plus traps), from the hart's cycle counter. */
  steps: number;
  /** 'stopped' when `stop` is set; 'wfi' when parked with nothing to wake it. */
  reason: 'budget' | 'wfi' | 'stopped';
  stop?: StopEvent;
}

/** Run up to `steps` steps, turning a stop-hook signal into a result. */
export function runMachine(m: Machine, steps: number): RunOutcome {
  const before = m.hart.cycles;
  try {
    const r = m.run(steps);
    return { steps: m.hart.cycles - before, reason: r.reason };
  } catch (e) {
    if (e instanceof StopSignal) return { steps: m.hart.cycles - before, reason: 'stopped', stop: e.event };
    throw e;
  }
}

/** "line 12" for main.s, "lib.s line 3" for a library, else the hex address. */
export function where(link: LinkResult, pc: number): string {
  const e = lineForAddress(link.sourceMap, pc >>> 0);
  if (!e) return `address ${hex32(pc)}`;
  return e.file === MAIN_FILE ? `line ${e.line}` : `${e.file} line ${e.line}`;
}

/** True when pc is past the program's code (e.g. it ran off the end into zeroed RAM). */
function pastCode(link: LinkResult, pc: number): boolean {
  return !lineForAddress(link.sourceMap, pc >>> 0) && pc >>> 0 >= RAM_BASE && pc >>> 0 < RAM_BASE + 0x4000000;
}

const EXIT_HINT = 'end the program with ebreak, or with li a7, 93 then ecall';

/** Plain-English explanation of an unhandled trap (E-CPU-05/07/08/09). */
export function trapMessage(m: Machine, link: LinkResult, ev: Extract<StopEvent, { kind: 'trap' }>): string {
  const at = where(link, ev.pc);
  const word = m.hart.physRead(ev.pc | 0, 4);
  const instr = word === undefined ? '' : ` (${disassembleWord(word, ev.pc).text})`;
  const addr = hex32(ev.tval);
  switch (ev.cause) {
    case CAUSE.illegalInstruction:
      if (ev.tval === 0 && pastCode(link, ev.pc))
        return `The program ran past the end of its code into empty memory at ${hex32(ev.pc)} (illegal instruction 0x00000000). Did you forget to stop? ${EXIT_HINT}.`;
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
      return `Store access fault at ${at}${instr}: address ${addr} cannot be written (nothing there, or read-only).`;
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

/** Formats an assembler diagnostic as `main.s:3:5: message`. */
export const formatDiag = (d: Diagnostic): string => `${d.file}:${d.line}:${d.col}: ${d.message}`;
