/**
 * ASM-04 / DEV-*: the RISC-V debugger side of the worker. Owns one RV32
 * machine built from the player's source (through @build-a-computer/rv-check,
 * so the debugger runs exactly what the tests run), and runs it in ≤ 8 ms
 * slices so pause always works (E-SIM-10).
 */

import type { Diagnostic } from '@build-a-computer/asm';
import {
  type Program,
  type RiscvCaseResult,
  type RiscvDebugSetup,
  type RunEnd,
  type RunSetup,
  type StopEvent,
  SetupError,
  applyInput,
  asmToProgramDiagnostic,
  buildProgram,
  checkExpectRegs,
  clipCheck,
  createMachine,
  judgeRiscv,
  LINE_HITS_MAX_STEPS,
  lineHits,
  machineReadout,
  riscvChecks,
  riscvDebugSetup,
  runMachine,
  trapMessage,
} from '@build-a-computer/rv-check';
import type { Machine } from '@build-a-computer/rv32';
import type { Level } from '@build-a-computer/schema';
import type {
  RvApi,
  RvLoadOptions,
  RvLoadResult,
  RvSnapshot,
  RvState,
  RvStopReason,
  RvTestView,
  RvTranslation,
  SourceDiagnostic,
} from './protocol';
import { sv32Translate } from './sv32';

const SLICE_MS = 8;
const SNAPSHOT_MS = 1000 / 60;
/** Steps between clock checks inside a slice (no breakpoints). */
const BATCH = 20_000;
/** Single steps between clock checks when stepping one instruction at a time. */
const SINGLE_BATCH = 2_000;
/** Most instructions one rvStep call runs synchronously. */
const MAX_SYNC_STEPS = 1_000_000;
/** UART text kept for the console. */
const UART_TAIL = 64 * 1024;
/** Most bytes one rvMemory call returns. */
const MAX_MEMORY_READ = 1024 * 1024;
/** Most words one rvReadWords call returns. */
const MAX_WORDS_READ = 256 * 1024;
/** Most sectors one rvDisk call returns. */
const MAX_DISK_SECTORS = 2048;
/** Most instructions run from `_start` to `main` (C levels, stopAtMain). */
const MAX_TO_MAIN = 5_000_000;

const MODES = { 3: 'M', 1: 'S', 0: 'U' } as const;

/** Convert an assembler diagnostic to the protocol's 1-based range form. */
export function toSourceDiagnostic(d: Diagnostic, text: string | undefined): SourceDiagnostic {
  return asmToProgramDiagnostic(d, text);
}

type Goal = { kind: 'run' } | { kind: 'line'; from: number | undefined };

export class RvHost implements RvApi {
  private level: Level | null = null;
  private program: Program | null = null;
  private m: Machine | null = null;
  private setup: RunSetup = {};
  /** "Debug this test": the test whose setup, input and expectations the machine uses. */
  private debug: RiscvDebugSetup | null = null;
  private stopAtMain = false;
  /** The debugged test's verdict once the program ended (cleared when it runs again). */
  private verdict: RiscvCaseResult | undefined;
  /** How often each line of the player's file ran, for the verdict (replayed when it ended). */
  private hits: { line: number; count: number }[] | undefined;
  /** The debugged test's step limit was reported (running on past it is allowed). */
  private budgetReported = false;
  /** Framebuffer hash at the last stop (hashing 64,000 bytes per frame while running is wasteful). */
  private fbSha: string | undefined;
  private listener: ((s: RvSnapshot) => void) | null = null;
  private bpLines: number[] = [];
  private bpAddrs = new Set<number>();
  private goal: Goal | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshotAt = -Infinity;
  private reason: RvStopReason | undefined;
  private exitCode: number | undefined;
  private trap: RvState['trap'];
  /** Exit or unhandled trap: nothing runs until a reset. */
  private finished = false;
  /** Stopped at ebreak: the next run/step steps over it. */
  private atEbreak = false;
  /** Parked in WFI while running: input resumes the run. */
  private resumeOnInput = false;
  /** Resuming from a breakpoint: execute that instruction before checking again. */
  private skipBreakpoint = false;
  // UART console.
  private uartText = '';
  private uartPending: number[] = [];
  private decoder = new TextDecoder();
  // Framebuffer change tracking.
  private fbDirty = false;
  private fbVersion = 0;

  constructor(
    private readonly now: () => number,
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>,
  ) {}

  rvSubscribe(onSnapshot: (s: RvSnapshot) => void): void {
    this.listener = onSnapshot;
    this.emit(true);
  }

  /**
   * Build the program (assembly, or C compiled with libc) and a fresh machine.
   * The machine gets the level's RAM size and the first 'riscv' test's setup
   * (registers, memory pokes and disk sectors, not input) so the debugger
   * starts where test 1 starts. The level's device list only affects which
   * panels the UI shows (and whether there is a disk); the machine has the
   * full map. Diagnostics, lines and breakpoints are in the player's file:
   * `main.c` lines for C levels.
   *
   * With `opts.test` ("Debug this test") the machine gets that test's setup,
   * input (UART and keyboard) and disk, every snapshot carries the test's
   * expectations against the machine (`RvSnapshot.test`), and the verdict is
   * judged as the checker would when the program ends. `opts.stopAtMain`
   * (C levels) runs the startup code and stops at `main`. Reset keeps both.
   */
  rvLoad(source: string, level: Level, opts: RvLoadOptions = {}): RvLoadResult {
    this.stopTimer();
    this.level = level;
    const program = buildProgram(source, level);
    const diagnostics: SourceDiagnostic[] = program.diagnostics.map((d) => ({ ...d }));
    this.debug = opts.test !== undefined ? (riscvDebugSetup(level, opts.test) ?? null) : null;
    this.stopAtMain = !!opts.stopAtMain;
    if (this.debug) this.setup = this.debug.setup;
    else {
      const first = level.tests.find((t) => t.kind === 'riscv');
      this.setup = first?.kind === 'riscv' ? (first.setup ?? {}) : {};
    }
    this.program = program.ok ? program : null;
    this.m = null;
    let ok = program.ok;
    if (program.ok) {
      try {
        if (this.debug) checkExpectRegs(this.debug.test.expect);
        this.resetMachine();
      } catch (e) {
        if (!(e instanceof SetupError)) throw e;
        ok = false;
        this.program = null;
        diagnostics.push({
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 1,
          message: e.message,
          severity: 'error',
          file: program.mainFile,
        });
      }
    }
    if (!this.m) this.clearRunState();
    this.rvSetBreakpoints(this.bpLines);
    this.emit(true);
    return {
      ok,
      diagnostics,
      symbols: program.ok ? program.symbols.map((s) => ({ ...s })) : [],
      entry: program.entry,
      ...(this.debug ? { test: { index: this.debug.index, name: this.debug.name } } : {}),
    };
  }

  rvReset(): void {
    this.stopTimer();
    if (this.program && this.level) this.resetMachine();
    this.emit(true);
  }

  rvSetBreakpoints(lines: number[]): void {
    this.bpLines = [...lines];
    this.bpAddrs.clear();
    const link = this.program;
    if (!link) return;
    // Lines that hold no code (comments, labels, blank) break on the next line with code.
    for (const line of lines) for (const a of link.breakpointAddresses(line)) this.bpAddrs.add(a);
  }

  rvRun(): void {
    this.start({ kind: 'run' });
  }

  rvStepLine(): void {
    const m = this.m;
    if (!m || !this.program) return;
    const e = this.program.locate(m.hart.pc);
    this.start({ kind: 'line', from: e?.file === this.program.mainFile ? e.line : undefined });
  }

  rvPause(): void {
    this.resumeOnInput = false;
    if (!this.goal) return;
    this.stopTimer();
    this.halt('paused');
    this.emit(true);
  }

  rvStep(n: number): void {
    const m = this.m;
    if (!m || this.finished) return;
    this.stopTimer();
    this.goal = null;
    this.resumeOnInput = false;
    this.reason = undefined;
    this.verdict = undefined;
    this.hits = undefined;
    this.skipEbreak();
    const count = Math.max(0, Math.min(Math.floor(n), MAX_SYNC_STEPS));
    const ev = this.bpAddrs.size ? this.single(count, null, true) : this.bulk(count);
    if (ev !== 'continue' && ev !== 'done') this.onStop(ev);
    else if (!this.overBudget()) this.halt('step');
    this.emit(true);
  }

  rvInput(text: string): void {
    const m = this.m;
    if (!m) return;
    m.uart.receive(text);
    for (const b of new TextEncoder().encode(text)) m.keyboard.press(b);
    if (this.resumeOnInput && !this.goal) this.start({ kind: 'run' });
    else this.emit(true);
  }

  rvMemory(addr: number, length: number): Uint8Array {
    const out = new Uint8Array(Math.max(0, Math.min(Math.floor(length), MAX_MEMORY_READ)));
    const m = this.m;
    if (!m) return out;
    // Only plain memory is read: device registers have read side effects (UART rx).
    for (const map of m.bus.mappings) {
      const dev = map.device as { bytes?: Uint8Array };
      if (!(dev.bytes instanceof Uint8Array)) continue;
      const lo = Math.max(addr >>> 0, map.base);
      const hi = Math.min((addr >>> 0) + out.length, map.base + map.size);
      if (lo < hi) out.set(dev.bytes.subarray(lo - map.base, hi - map.base), lo - (addr >>> 0));
    }
    return out;
  }

  rvReadWords(addr: number, count: number, stride = 4): Uint32Array {
    const out = new Uint32Array(Math.max(0, Math.min(Math.floor(count), MAX_WORDS_READ)));
    const m = this.m;
    if (!m) return out;
    const step = Math.max(4, Math.floor(stride) & ~3);
    for (let i = 0; i < out.length; i++) out[i] = this.word((addr >>> 0) + i * step) ?? 0;
    return out;
  }

  rvTranslate(va: number, satp?: number, access: 'fetch' | 'load' | 'store' = 'load'): RvTranslation | null {
    const m = this.m;
    if (!m) return null;
    const h = m.hart;
    const MXR = 1 << 19;
    const SUM = 1 << 18;
    return sv32Translate((pa) => this.word(pa), satp ?? h.satp >>> 0, va, access, 'U', {
      mxr: (h.mstatus & MXR) !== 0,
      sum: (h.mstatus & SUM) !== 0,
    });
  }

  rvDisk(sector: number, count: number): Uint8Array {
    const storage = this.m?.block.storage;
    if (!storage) return new Uint8Array(0);
    const from = Math.max(0, Math.floor(sector)) * 512;
    const n = Math.max(0, Math.min(Math.floor(count), MAX_DISK_SECTORS)) * 512;
    return storage.slice(Math.min(from, storage.length), Math.min(from + n, storage.length));
  }

  /** A little-endian word of plain memory (RAM, ROM, framebuffer); undefined elsewhere. */
  private word(pa: number): number | undefined {
    const m = this.m;
    if (!m) return undefined;
    pa >>>= 0;
    for (const map of m.bus.mappings) {
      const dev = map.device as { bytes?: Uint8Array };
      if (!(dev.bytes instanceof Uint8Array)) continue;
      const off = pa - map.base;
      if (off < 0 || off + 4 > map.size || off + 4 > dev.bytes.length) continue;
      const b = dev.bytes;
      return (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
    }
    return undefined;
  }

  /**
   * Pixels (320x200, one palette index each) and the palette as 0xRRGGBBAA
   * (alpha 0xff); null before a successful load or when the level shows no
   * framebuffer.
   */
  rvFramebuffer(): { pixels: Uint8Array; palette: Uint32Array } | null {
    const m = this.m;
    if (!m || !(this.level?.code?.devices ?? []).includes('framebuffer')) return null;
    const palette = new Uint32Array(256);
    for (let i = 0; i < 256; i++) palette[i] = (((m.fbControl.palette[i] ?? 0) << 8) | 0xff) >>> 0;
    return { pixels: m.fbPixels.bytes.slice(), palette };
  }

  // -------------------------------------------------------------------------

  private clearRunState(): void {
    this.goal = null;
    this.reason = undefined;
    this.exitCode = undefined;
    this.trap = undefined;
    this.finished = false;
    this.atEbreak = false;
    this.resumeOnInput = false;
    this.uartText = '';
    this.uartPending = [];
    this.decoder = new TextDecoder();
    this.fbDirty = false;
    this.fbVersion++;
    this.verdict = undefined;
    this.hits = undefined;
    this.budgetReported = false;
    this.fbSha = undefined;
  }

  private resetMachine(): void {
    this.clearRunState();
    const m = createMachine(this.program!, this.level!, this.setup, {
      onUartTx: (b) => this.uartPending.push(b),
    });
    // Cheap framebuffer change detection: flag any guest write to pixels or palette.
    for (const dev of [m.fbPixels, m.fbControl]) {
      const write = dev.write.bind(dev);
      dev.write = (offset, width, value) => {
        this.fbDirty = true;
        return write(offset, width, value);
      };
    }
    this.m = m;
    if (this.debug) applyInput(m, this.debug.input);
    if (this.stopAtMain) this.runToMain();
  }

  /** C levels: run the startup code (crt0) up to the first instruction of `main`, then pause there. */
  private runToMain(): void {
    const m = this.m!;
    const program = this.program!;
    if (program.language !== 'c') return;
    const main = program.symbols.find((s) => s.name === 'main');
    if (!main || m.hart.pc === main.addr) return;
    for (let i = 0; i < MAX_TO_MAIN; i++) {
      const r = runMachine(m, 1);
      if (r.stop) return this.onStop(r.stop);
      if (r.reason === 'wfi') return this.onStop('wfi');
      if (m.hart.pc >>> 0 === main.addr >>> 0) return this.halt('step');
    }
  }

  private start(goal: Goal): void {
    if (!this.m || this.finished) return;
    this.goal = goal;
    this.reason = undefined;
    this.verdict = undefined;
    this.hits = undefined;
    this.resumeOnInput = false;
    this.skipEbreak();
    this.skipBreakpoint = true;
    this.emit(true);
    if (!this.timer) this.loop();
  }

  private skipEbreak(): void {
    if (this.atEbreak && this.m) this.m.hart.pc = (this.m.hart.pc + 4) >>> 0;
    this.atEbreak = false;
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Stop with a reason (not running any more). */
  private halt(reason: RvStopReason): void {
    this.goal = null;
    this.reason = reason;
    this.stopTimer();
  }

  private onStop(ev: StopEvent | 'breakpoint' | 'step' | 'wfi'): void {
    const wasRunning = this.goal?.kind === 'run';
    if (ev === 'breakpoint' || ev === 'step') return this.halt(ev);
    if (ev === 'wfi') {
      this.halt('wfi');
      this.resumeOnInput = wasRunning;
      // The test's input is queued before the first instruction: waiting with nothing pending fails it.
      this.judge({ ended: 'wfi' });
      return;
    }
    this.judge({ stop: ev });
    if (ev.kind === 'ebreak') {
      this.atEbreak = true;
      return this.halt('ebreak');
    }
    this.finished = true;
    if (ev.kind === 'exit') {
      this.exitCode = ev.code;
      return this.halt('exit');
    }
    this.trap = {
      cause: ev.cause,
      tval: ev.tval,
      message: trapMessage(this.m!, this.program!, ev),
    };
    this.halt('trap');
  }

  /** The debugged test's verdict for how the run ended (the checker's judgement on this machine). */
  private judge(run: { stop?: StopEvent; ended?: RunEnd }): void {
    if (!this.debug || !this.m || !this.program) return;
    this.fbSha = undefined;
    this.verdict = judgeRiscv(this.program, this.m, this.debug.test, { ...run, maxSteps: this.debug.maxSteps });
    const steps = this.m.hart.cycles;
    this.hits = steps <= LINE_HITS_MAX_STEPS ? lineHits(this.program, this.level!, this.setup, this.debug.input, steps) : undefined;
  }

  /**
   * Past the debugged test's step limit the test would fail: pause once with
   * that verdict (the player may run on). Returns true when it paused.
   */
  private overBudget(): boolean {
    const d = this.debug;
    if (!d || this.budgetReported || !this.m || this.m.hart.cycles < d.maxSteps) return false;
    this.budgetReported = true;
    this.halt('budget');
    this.judge({ ended: 'steps' });
    return true;
  }

  /**
   * Run `count` steps at full speed (no breakpoints). Returns 'continue' when
   * the steps ran out, or what stopped the machine.
   */
  private bulk(count: number): StopEvent | 'wfi' | 'continue' {
    // Stop exactly at the debugged test's step limit, as the checker does.
    const d = this.debug;
    if (d && !this.budgetReported) count = Math.max(1, Math.min(count, d.maxSteps - this.m!.hart.cycles));
    const r = runMachine(this.m!, count);
    if (r.stop) return r.stop;
    if (r.reason === 'wfi') return 'wfi';
    return 'continue';
  }

  /**
   * Run up to `count` single instructions, checking breakpoints before each
   * and the step-line goal after each. `skipFirst` ignores a breakpoint on
   * the first instruction (resuming from it).
   */
  private single(
    count: number,
    goal: Goal | null,
    skipFirst: boolean,
  ): StopEvent | 'wfi' | 'breakpoint' | 'step' | 'continue' | 'done' {
    const m = this.m!;
    const link = this.program!;
    for (let i = 0; i < count; i++) {
      if (!(skipFirst && i === 0) && this.bpAddrs.has(m.hart.pc)) return 'breakpoint';
      const r = runMachine(m, 1);
      if (r.stop) return r.stop;
      if (r.reason === 'wfi') return 'wfi';
      if (goal?.kind === 'line') {
        const e = link.locate(m.hart.pc);
        if (e && e.file === link.mainFile && e.line !== goal.from) return 'step';
      }
    }
    return 'done';
  }

  /** One ≤ 8 ms slice, then yield so pause and input are handled (E-SIM-10). */
  private loop = (): void => {
    this.timer = null;
    const goal = this.goal;
    if (!goal || !this.m) return;
    const start = this.now();
    let ev: ReturnType<RvHost['single']>;
    do {
      if (goal.kind === 'run' && this.bpAddrs.size === 0) ev = this.bulk(BATCH);
      else {
        ev = this.single(SINGLE_BATCH, goal, this.skipBreakpoint);
      }
      this.skipBreakpoint = false;
    } while ((ev === 'continue' || ev === 'done') && this.now() - start < SLICE_MS && !this.atBudget());
    if (ev !== 'continue' && ev !== 'done') {
      this.onStop(ev);
      this.emit(true);
      return;
    }
    if (this.overBudget()) {
      this.emit(true);
      return;
    }
    this.emit(false);
    this.timer = this.schedule(this.loop, 0);
  };

  private emit(force: boolean): void {
    if (!this.listener) return;
    const t = this.now();
    if (!force && t - this.lastSnapshotAt < SNAPSHOT_MS) return;
    this.lastSnapshotAt = t;
    this.listener(this.snapshot());
  }

  /** The current debugger view (also used by tests). */
  snapshot(): RvSnapshot {
    if (this.uartPending.length) {
      this.uartText += this.decoder.decode(new Uint8Array(this.uartPending), { stream: true });
      this.uartPending = [];
      if (this.uartText.length > UART_TAIL) this.uartText = this.uartText.slice(-UART_TAIL);
    }
    if (this.fbDirty) {
      this.fbDirty = false;
      this.fbVersion++;
    }
    const test = this.testView();
    return { state: this.state(), uart: this.uartText, fbVersion: this.fbVersion, ...(test ? { test } : {}) };
  }

  private atBudget(): boolean {
    const d = this.debug;
    return !!d && !this.budgetReported && !!this.m && this.m.hart.cycles >= d.maxSteps;
  }

  /** The debugged test against the machine now. */
  private testView(): RvTestView | undefined {
    const d = this.debug;
    if (!d) return undefined;
    const view: RvTestView = { index: d.index, name: d.name, setup: d.setup, maxSteps: d.maxSteps, checks: [], ...(d.input ? { input: d.input } : {}) };
    const m = this.m;
    if (m) {
      const r = machineReadout(m, this.exitCode ?? null);
      const running = this.goal !== null;
      const fb = r.framebufferSha256;
      r.framebufferSha256 = () => (running ? (this.fbSha ?? '') : (this.fbSha ??= fb()));
      try {
        view.checks = riscvChecks(d.test.expect, r).map(clipCheck);
      } catch (e) {
        if (!(e instanceof SetupError)) throw e;
      }
    }
    if (this.verdict) view.verdict = this.verdict;
    if (this.verdict && this.hits) view.lineHits = this.hits;
    return view;
  }

  private state(): RvState {
    const m = this.m;
    const running = this.goal !== null;
    if (!m)
      return {
        pc: 0,
        regs: new Array<number>(32).fill(0),
        mode: 'M',
        instret: 0,
        running: false,
        csrs: {},
      };
    const h = m.hart;
    const st: RvState = {
      pc: h.pc,
      regs: Array.from(h.x, (v) => v >>> 0),
      mode: MODES[h.priv],
      instret: h.instret,
      running,
      csrs: {
        mstatus: h.mstatus >>> 0,
        mepc: h.mepc >>> 0,
        mcause: h.mcause >>> 0,
        mtval: h.mtval >>> 0,
        mtvec: h.mtvec >>> 0,
        mie: h.mie >>> 0,
        mip: h.mip >>> 0,
        mscratch: h.mscratch >>> 0,
        medeleg: h.medeleg >>> 0,
        mideleg: h.mideleg >>> 0,
        satp: h.satp >>> 0,
        sepc: h.sepc >>> 0,
        scause: h.scause >>> 0,
        stval: h.stval >>> 0,
        stvec: h.stvec >>> 0,
      },
    };
    const e = this.program?.locate(h.pc);
    if (e) {
      st.line = e.line;
      st.file = e.file;
    }
    if (!running && this.reason) st.reason = this.reason;
    if (this.exitCode !== undefined) st.exitCode = this.exitCode;
    if (this.trap) st.trap = this.trap;
    return st;
  }
}
