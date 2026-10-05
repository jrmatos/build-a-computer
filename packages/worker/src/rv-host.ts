/**
 * ASM-04 / DEV-*: the RISC-V debugger side of the worker. Owns one RV32
 * machine built from the player's source (through @build-a-computer/rv-check,
 * so the debugger runs exactly what the tests run), and runs it in ≤ 8 ms
 * slices so pause always works (E-SIM-10).
 */

import { type Diagnostic, type LinkResult, lineForAddress } from '@build-a-computer/asm';
import {
  MAIN_FILE,
  type RunSetup,
  type StopEvent,
  SetupError,
  buildProgram,
  createMachine,
  runMachine,
  trapMessage,
} from '@build-a-computer/rv-check';
import type { Machine } from '@build-a-computer/rv32';
import type { Level } from '@build-a-computer/schema';
import type { RvApi, RvLoadResult, RvSnapshot, RvState, RvStopReason, SourceDiagnostic } from './protocol';

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

const MODES = { 3: 'M', 1: 'S', 0: 'U' } as const;

/** 1-based line/column of a 0-based character offset. */
function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

/** Convert an assembler diagnostic to the protocol's 1-based range form. */
export function toSourceDiagnostic(d: Diagnostic, text: string | undefined): SourceDiagnostic {
  const end = text !== undefined && d.to > d.from ? position(text, d.to) : { line: d.line, column: d.col + 1 };
  return {
    line: d.line,
    column: d.col,
    endLine: end.line,
    endColumn: end.column,
    message: d.message,
    severity: d.severity,
    file: d.file,
  };
}

type Goal = { kind: 'run' } | { kind: 'line'; from: number | undefined };

export class RvHost implements RvApi {
  private level: Level | null = null;
  private link: LinkResult | null = null;
  private m: Machine | null = null;
  private setup: RunSetup = {};
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
   * Assemble + link, then build a fresh machine. The machine gets the level's
   * RAM size and the first 'riscv' test's setup (registers and memory pokes,
   * not input) so the debugger starts where test 1 starts. The level's device
   * list only affects which panels the UI shows; the machine has the full map.
   */
  rvLoad(source: string, level: Level): RvLoadResult {
    this.stopTimer();
    this.level = level;
    const texts = new Map<string, string>([[MAIN_FILE, source], ...(level.code?.library ?? []).map((f) => [f.name, f.text] as [string, string])]);
    const link = buildProgram(source, level);
    const diagnostics = link.diagnostics.map((d) => toSourceDiagnostic(d, texts.get(d.file)));
    const first = level.tests.find((t) => t.kind === 'riscv');
    this.setup = first?.kind === 'riscv' ? (first.setup ?? {}) : {};
    this.link = link.ok ? link : null;
    this.m = null;
    let ok = link.ok;
    if (link.ok) {
      try {
        this.resetMachine();
      } catch (e) {
        if (!(e instanceof SetupError)) throw e;
        ok = false;
        this.link = null;
        diagnostics.push({ line: 1, column: 1, endLine: 1, endColumn: 1, message: e.message, severity: 'error', file: MAIN_FILE });
      }
    }
    if (!this.m) this.clearRunState();
    this.rvSetBreakpoints(this.bpLines);
    this.emit(true);
    return {
      ok,
      diagnostics,
      symbols: link.ok ? link.symbols.filter((s) => s.kind === 'label').map((s) => ({ name: s.name, addr: s.address })) : [],
      entry: link.entry,
    };
  }

  rvReset(): void {
    this.stopTimer();
    if (this.link && this.level) this.resetMachine();
    this.emit(true);
  }

  rvSetBreakpoints(lines: number[]): void {
    this.bpLines = [...lines];
    this.bpAddrs.clear();
    const link = this.link;
    if (!link) return;
    for (const line of lines) {
      // Lines that hold no code (comments, labels) break on the next line with code.
      const at = link.sourceMap
        .filter((e) => e.file === MAIN_FILE && e.kind === 'code' && e.line >= line)
        .sort((a, b) => a.line - b.line || a.address - b.address)[0];
      if (!at) continue;
      for (const e of link.sourceMap)
        if (e.file === MAIN_FILE && e.kind === 'code' && e.line === at.line) this.bpAddrs.add(e.address >>> 0);
    }
  }

  rvRun(): void {
    this.start({ kind: 'run' });
  }

  rvStepLine(): void {
    const m = this.m;
    if (!m || !this.link) return;
    const e = lineForAddress(this.link.sourceMap, m.hart.pc);
    this.start({ kind: 'line', from: e?.file === MAIN_FILE ? e.line : undefined });
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
    this.skipEbreak();
    const count = Math.max(0, Math.min(Math.floor(n), MAX_SYNC_STEPS));
    const ev = this.bpAddrs.size ? this.single(count, null, true) : this.bulk(count);
    if (ev !== 'continue' && ev !== 'done') this.onStop(ev);
    else this.halt('step');
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
  }

  private resetMachine(): void {
    this.clearRunState();
    const m = createMachine(this.link!, this.level!, this.setup, { onUartTx: (b) => this.uartPending.push(b) });
    // Cheap framebuffer change detection: flag any guest write to pixels or palette.
    for (const dev of [m.fbPixels, m.fbControl]) {
      const write = dev.write.bind(dev);
      dev.write = (offset, width, value) => {
        this.fbDirty = true;
        return write(offset, width, value);
      };
    }
    this.m = m;
  }

  private start(goal: Goal): void {
    if (!this.m || this.finished) return;
    this.goal = goal;
    this.reason = undefined;
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
      return;
    }
    if (ev.kind === 'ebreak') {
      this.atEbreak = true;
      return this.halt('ebreak');
    }
    this.finished = true;
    if (ev.kind === 'exit') {
      this.exitCode = ev.code;
      return this.halt('exit');
    }
    this.trap = { cause: ev.cause, tval: ev.tval, message: trapMessage(this.m!, this.link!, ev) };
    this.halt('trap');
  }

  /**
   * Run `count` steps at full speed (no breakpoints). Returns 'continue' when
   * the steps ran out, or what stopped the machine.
   */
  private bulk(count: number): StopEvent | 'wfi' | 'continue' {
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
  private single(count: number, goal: Goal | null, skipFirst: boolean): StopEvent | 'wfi' | 'breakpoint' | 'step' | 'continue' | 'done' {
    const m = this.m!;
    const link = this.link!;
    for (let i = 0; i < count; i++) {
      if (!(skipFirst && i === 0) && this.bpAddrs.has(m.hart.pc)) return 'breakpoint';
      const r = runMachine(m, 1);
      if (r.stop) return r.stop;
      if (r.reason === 'wfi') return 'wfi';
      if (goal?.kind === 'line') {
        const e = lineForAddress(link.sourceMap, m.hart.pc);
        if (e && e.file === MAIN_FILE && e.line !== goal.from) return 'step';
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
    } while ((ev === 'continue' || ev === 'done') && this.now() - start < SLICE_MS);
    if (ev !== 'continue' && ev !== 'done') {
      this.onStop(ev);
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
    return { state: this.state(), uart: this.uartText, fbVersion: this.fbVersion };
  }

  private state(): RvState {
    const m = this.m;
    const running = this.goal !== null;
    if (!m) return { pc: 0, regs: new Array<number>(32).fill(0), mode: 'M', instret: 0, running: false, csrs: {} };
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
    const e = this.link ? lineForAddress(this.link.sourceMap, h.pc) : undefined;
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
