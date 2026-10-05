import { Prng } from '@build-a-computer/det';
import { assertRunnable, type CompiledPart, type Netlist } from './compile';
import { gateSignal } from './library';
import { V0, V1, VX, allX, mask, type Signal, type Value } from './values';

export interface EngineOptions {
  /** Seed for power-on randomness. */
  seed?: number;
  /** How volatile state starts at power on (E-SIM-07). */
  powerOnState?: 'zero' | 'random';
  /** Events allowed per part per settle. */
  eventBudgetPerPart?: number;
  /** Hard cap on events per settle. */
  maxEventsPerSettle?: number;
}

export interface SettleResult {
  stable: boolean;
  /** Nets still changing when the budget ran out (E-SIM-01). */
  unstableNets: number[];
  /** Nets where two drivers disagree on a bit (E-SIM-02, tri-state buses). */
  contentionNets: number[];
  events: number;
}

/** Hidden state both engines must agree on (differential tests). */
export interface InternalState {
  slotV: Uint32Array;
  slotX: Uint32Array;
  slotZ: Uint32Array;
  /** Flip-flop state (bit 0) and its X flag. */
  stV: Uint32Array;
  stX: Uint32Array;
  /** Last clock level seen by each clocked part (0, 1 or X). */
  prevClk: Uint8Array;
  /** Block states, serialized (only for parts with a block). */
  blocks: string[];
}

/** The engine surface shared by ReferenceEngine and FastEngine. */
export interface Engine {
  readonly nl: Netlist;
  readonly netV: Uint32Array;
  readonly netX: Uint32Array;
  readonly isPowered: boolean;
  readonly clock: Value;
  ticks: number;
  powerOn(): SettleResult;
  powerOff(): void;
  tick(): SettleResult;
  setSwitch(partId: string, on: boolean): SettleResult;
  setValue(partId: string, value: number): SettleResult;
  press(partId: string, down: boolean): SettleResult;
  isSwitchOn(partId: string): boolean;
  switchValue(partId: string): number;
  readPin(partId: string, pin: string): Value;
  readSignal(partId: string, pin: string): Signal;
  netSignal(n: number): Signal;
  netValue(n: number): Value;
  memory(partId: string): number[];
  internalState(): InternalState;
}

/** True for parts evaluated as pure functions of their inputs. */
export const isCombinational = (p: CompiledPart): boolean =>
  p.kind === 'gate' ||
  p.kind === 'buffer' ||
  p.kind === 'tristate' ||
  p.kind === 'splitter' ||
  p.kind === 'joiner' ||
  (p.kind === 'block' && !p.clocked);

const bitValue = (v: number, x: number): Value => ((x & 1) !== 0 ? VX : ((v & 1) as Value));

/** Serialize a block state for comparisons (typed arrays become plain arrays). */
export function stateKey(s: unknown): string {
  return JSON.stringify(s, (_k, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)) ?? '';
}

type Change = [slot: number, v: number, x: number, z: number];

/**
 * Reference engine: plain event-driven simulation with unit gate delay.
 * Every part whose inputs changed is evaluated in one wave; their output
 * changes land together and wake the readers for the next wave.
 * Slow and simple on purpose; the fast engine (SIM-04) is fuzzed against it.
 *
 * Values: every net is a Signal of its width (1..32) with a per-bit X mask.
 * Output slots also carry a Z mask (tri-state). A net resolves bit by bit
 * from its non-Z drivers: none -> X (floating), all agree -> that value,
 * any X -> X, a 0 and a 1 -> X plus contention.
 */
export class ReferenceEngine implements Engine {
  readonly netV: Uint32Array;
  readonly netX: Uint32Array;
  private readonly slotV: Uint32Array;
  private readonly slotX: Uint32Array;
  private readonly slotZ: Uint32Array;
  private readonly stV: Uint32Array;
  private readonly stX: Uint32Array;
  private readonly prevClk: Uint8Array;
  private readonly blockState: unknown[];
  private readonly inputValue: Uint32Array;
  private clockLevel: Value = V0;
  private readonly contention = new Set<number>();
  private readonly budget: number;
  private readonly prng: Prng;
  private powered = false;
  /** Total clock half-periods since power on. */
  ticks = 0;

  constructor(
    readonly nl: Netlist,
    private readonly opts: EngineOptions = {},
  ) {
    assertRunnable(nl);
    const P = nl.parts.length;
    this.netV = new Uint32Array(nl.netCount);
    this.netX = Uint32Array.from(nl.netWidth, (w) => mask(w));
    const S = nl.slotNet.length;
    this.slotV = new Uint32Array(S);
    this.slotX = Uint32Array.from(nl.slotWidth, (w) => mask(w));
    this.slotZ = new Uint32Array(S);
    this.stV = new Uint32Array(P);
    this.stX = new Uint32Array(P).fill(1);
    this.prevClk = new Uint8Array(P).fill(VX);
    this.blockState = new Array<unknown>(P).fill(undefined);
    this.inputValue = Uint32Array.from(nl.parts, (p) => p.initialValue);
    const perPart = opts.eventBudgetPerPart ?? 1000;
    this.budget = Math.min(perPart * Math.max(1, P), opts.maxEventsPerSettle ?? 5_000_000);
    this.prng = new Prng(opts.seed ?? 1);
  }

  get isPowered(): boolean {
    return this.powered;
  }

  get clock(): Value {
    return this.clockLevel;
  }

  /**
   * Power on: volatile state starts at 0 or seeded random, then settles.
   * Feedback loops left at X are resolved one gate at a time, the way a real
   * circuit falls into one stable state (an SR latch picks a side; a NOT
   * ring keeps oscillating and is reported unstable).
   */
  powerOn(): SettleResult {
    this.powered = true;
    this.ticks = 0;
    this.clockLevel = V0;
    this.clearNets();
    this.contention.clear();
    const random = this.opts.powerOnState === 'random';
    this.nl.parts.forEach((p, i) => {
      if (p.kind === 'dff') {
        this.stV[i] = random ? this.prng.nextBit() : V0;
        this.stX[i] = 0;
        this.prevClk[i] = VX;
      } else if (p.block) {
        if (!(p.nonVolatile && this.blockState[i] !== undefined)) {
          this.blockState[i] = p.block.init(p.part, random ? 'random' : 'zero', this.prng);
        }
        if (p.clocked) this.prevClk[i] = VX;
      }
      this.writeSourceOutputs(i);
    });
    for (let n = 0; n < this.nl.netCount; n++) this.refreshNet(n);

    let result = this.settle(this.nl.parts.map((_, i) => i));
    if (!result.stable) return result;
    for (let i = 0; i < this.nl.parts.length; i++) {
      const p = this.nl.parts[i]!;
      if (!p.inLoop || p.kind !== 'gate') continue;
      const s = p.outputSlots[0]!;
      const x = this.slotX[s]!;
      if (x === 0) continue;
      const r = random ? (p.width === 1 ? this.prng.nextBit() : this.prng.nextU32()) : 0;
      this.slotV[s] = (this.slotV[s]! | (r & x)) >>> 0;
      this.slotX[s] = 0;
      const n = this.nl.slotNet[s]!;
      const changed = this.refreshNet(n);
      result = this.settle(changed ? this.nl.netReaders[n]! : []);
      if (!result.stable) return result;
    }
    return result;
  }

  /** Power off clears every volatile value (E-SIM-08); non-volatile blocks (ROM) keep their state. */
  powerOff(): void {
    this.powered = false;
    this.clearNets();
    this.stV.fill(0);
    this.stX.fill(1);
    this.nl.parts.forEach((p, i) => {
      if (!p.nonVolatile) this.blockState[i] = undefined;
    });
    this.contention.clear();
  }

  setSwitch(partId: string, on: boolean): SettleResult {
    return this.setInput(partId, on ? 1 : 0, 'switch');
  }

  /** Set a switch (any width) to an unsigned value. */
  setValue(partId: string, value: number): SettleResult {
    return this.setInput(partId, value, 'switch');
  }

  /** Hold (down) or release a button; also works on 1-bit switches. */
  press(partId: string, down: boolean): SettleResult {
    return this.setInput(partId, down ? 1 : 0, 'button');
  }

  isSwitchOn(partId: string): boolean {
    const i = this.nl.partIndex.get(partId);
    return i !== undefined && this.inputValue[i] !== 0;
  }

  switchValue(partId: string): number {
    const i = this.nl.partIndex.get(partId);
    return i === undefined ? 0 : this.inputValue[i]!;
  }

  /** Advance the global clock by half a period: one tick. */
  tick(): SettleResult {
    if (!this.powered) return idle();
    this.ticks++;
    this.clockLevel = this.clockLevel === V1 ? V0 : V1;
    const woken: number[] = [];
    this.nl.parts.forEach((p, i) => {
      if (p.kind === 'clock') woken.push(...this.writeSourceOutputs(i));
    });
    return this.settle(woken);
  }

  readPin(partId: string, pin: string): Value {
    const n = this.nl.pinNet.get(`${partId}:${pin}`);
    return n === undefined ? VX : this.netValue(n);
  }

  readSignal(partId: string, pin: string): Signal {
    const n = this.nl.pinNet.get(`${partId}:${pin}`);
    return n === undefined ? allX(1) : this.netSignal(n);
  }

  netSignal(n: number): Signal {
    return { w: this.nl.netWidth[n]!, v: this.netV[n]!, x: this.netX[n]! };
  }

  netValue(n: number): Value {
    return bitValue(this.netV[n]!, this.netX[n]!);
  }

  /** Contents of a memory block (RAM, ROM, register) for inspection; empty when unknown. */
  memory(partId: string): number[] {
    const i = this.nl.partIndex.get(partId);
    if (i === undefined) return [];
    const p = this.nl.parts[i]!;
    const st = this.blockState[i];
    if (!p.block?.inspect || st === undefined) return [];
    return Array.from(p.block.inspect(st));
  }

  internalState(): InternalState {
    return {
      slotV: this.slotV.slice(),
      slotX: this.slotX.slice(),
      slotZ: this.slotZ.slice(),
      stV: this.stV.slice(),
      stX: this.stX.slice(),
      prevClk: this.prevClk.slice(),
      blocks: this.nl.parts.map((p, i) => (p.block ? stateKey(this.blockState[i]) : '')),
    };
  }

  // ------------------------------------------------------------ internals

  private setInput(partId: string, value: number, want: 'switch' | 'button'): SettleResult {
    const i = this.nl.partIndex.get(partId);
    const p = i === undefined ? undefined : this.nl.parts[i];
    if (i === undefined || !p || (p.kind !== 'switch' && p.kind !== 'button')) {
      throw new Error(`No ${want} named ${partId}`);
    }
    this.inputValue[i] = (value & mask(p.outputWidths[0]!)) >>> 0;
    if (!this.powered) return idle();
    return this.settle(this.writeSourceOutputs(i));
  }

  private clearNets(): void {
    this.netV.fill(0);
    this.nl.netWidth.forEach((w, n) => (this.netX[n] = mask(w)));
    this.slotV.fill(0);
    this.nl.slotWidth.forEach((w, s) => (this.slotX[s] = mask(w)));
    this.slotZ.fill(0);
  }

  private inputs(p: CompiledPart): Signal[] {
    return p.inputNets.map((n) => this.netSignal(n));
  }

  /** Evaluate one part; push its output changes. */
  private evaluate(pi: number, out: Change[]): void {
    const p = this.nl.parts[pi]!;
    const emit = (k: number, v: number, x: number, z: number): void => {
      const s = p.outputSlots[k]!;
      if (this.slotV[s] !== v >>> 0 || this.slotX[s] !== x >>> 0 || this.slotZ[s] !== z >>> 0) out.push([s, v >>> 0, x >>> 0, z >>> 0]);
    };
    const ins = this.inputs(p);
    switch (p.kind) {
      case 'gate': {
        const r = gateSignal(p.op, ins[0]!, ins[1] ?? ins[0]!, p.outputWidths[0]!);
        emit(0, r.v, r.x, 0);
        return;
      }
      case 'buffer':
        emit(0, ins[0]!.v, ins[0]!.x, 0);
        return;
      case 'tristate': {
        const m = mask(p.outputWidths[0]!);
        const en = ins[1]!;
        if (en.x & 1) emit(0, 0, m, 0);
        else if (en.v & 1) emit(0, ins[0]!.v, ins[0]!.x, 0);
        else emit(0, 0, 0, m);
        return;
      }
      case 'splitter': {
        const c = p.outputWidths[0]!;
        const cm = mask(c);
        for (let k = 0; k < p.outputSlots.length; k++) {
          const sh = k * c;
          emit(k, (ins[0]!.v >>> sh) & cm, (ins[0]!.x >>> sh) & cm, 0);
        }
        return;
      }
      case 'joiner': {
        const c = p.inputWidths[0]!;
        const cm = mask(c);
        let v = 0;
        let x = 0;
        for (let k = 0; k < ins.length; k++) {
          v |= (ins[k]!.v & cm) << (k * c);
          x |= (ins[k]!.x & cm) << (k * c);
        }
        emit(0, v, x, 0);
        return;
      }
      case 'dff': {
        const d = ins[0]!;
        const clk = bitValue(ins[1]!.v, ins[1]!.x);
        if (this.prevClk[pi] === V0 && clk === V1) {
          this.stV[pi] = d.v & 1;
          this.stX[pi] = d.x & 1;
        }
        this.prevClk[pi] = clk;
        emit(0, this.stV[pi]!, this.stX[pi]!, 0);
        return;
      }
      case 'block': {
        const b = p.block!;
        if (p.clocked) {
          const c = ins[p.clkInput]!;
          const clk = bitValue(c.v, c.x);
          if (this.prevClk[pi] === V0 && clk === V1) this.blockState[pi] = b.clock!(ins, this.blockState[pi], p.part);
          this.prevClk[pi] = clk;
        }
        const outs = b.outputs(ins, this.blockState[pi], p.part);
        for (let k = 0; k < p.outputSlots.length; k++) {
          const m = mask(p.outputWidths[k]!);
          const o = outs[k];
          const x = o ? o.x & m : m;
          emit(k, o ? o.v & ~x & m : 0, x, 0);
        }
        return;
      }
      default:
    }
  }

  /** Settle until no events remain or the budget runs out. */
  private settle(start: Iterable<number>): SettleResult {
    let dirty = new Set(start);
    let events = 0;
    let lastChanged: number[];
    while (dirty.size) {
      const changes: Change[] = [];
      for (const pi of dirty) this.evaluate(pi, changes);
      // All outputs of this wave change together (unit delay).
      const nets = new Set<number>();
      for (const [s, v, x, z] of changes) {
        this.slotV[s] = v;
        this.slotX[s] = x;
        this.slotZ[s] = z;
        nets.add(this.nl.slotNet[s]!);
      }
      const next = new Set<number>();
      lastChanged = [];
      for (const n of nets) {
        if (this.refreshNet(n)) {
          lastChanged.push(n);
          for (const r of this.nl.netReaders[n]!) next.add(r);
        }
      }
      events += changes.length;
      dirty = next;
      if (events > this.budget && dirty.size) {
        return { stable: false, unstableNets: this.collectUnstable(dirty, lastChanged), contentionNets: [...this.contention], events };
      }
    }
    return { stable: true, unstableNets: [], contentionNets: [...this.contention], events };
  }

  /** Run a few more waves of combinational parts after the budget to list every net still moving. */
  private collectUnstable(dirty: Set<number>, seed: number[]): number[] {
    const moving = new Set(seed);
    let wave = dirty;
    for (let k = 0; k < 64 && wave.size; k++) {
      const changes: Change[] = [];
      for (const pi of wave) if (isCombinational(this.nl.parts[pi]!)) this.evaluate(pi, changes);
      const next = new Set<number>();
      for (const [s, v, x, z] of changes) {
        this.slotV[s] = v;
        this.slotX[s] = x;
        this.slotZ[s] = z;
        const n = this.nl.slotNet[s]!;
        if (this.refreshNet(n)) {
          moving.add(n);
          for (const r of this.nl.netReaders[n]!) next.add(r);
        }
      }
      wave = next;
    }
    return [...moving].sort((a, b) => a - b);
  }

  /** Recompute a net from its drivers; returns true when its value changed. */
  private refreshNet(n: number): boolean {
    const drivers = this.nl.netDrivers[n]!;
    const m = mask(this.nl.netWidth[n]!);
    let v = 0;
    let x = m;
    if (drivers.length === 1) {
      const s = drivers[0]!;
      v = this.slotV[s]! & m;
      x = (this.slotX[s]! | this.slotZ[s]!) & m;
      v &= ~x;
    } else if (drivers.length > 1) {
      let any1 = 0;
      let any0 = 0;
      let anyX = 0;
      for (const s of drivers) {
        const d = ~this.slotZ[s]! & m;
        any1 |= this.slotV[s]! & d;
        anyX |= this.slotX[s]! & d;
        any0 |= ~(this.slotV[s]! | this.slotX[s]!) & d;
      }
      const k1 = any1 & ~any0 & ~anyX;
      const k0 = any0 & ~any1 & ~anyX;
      v = k1;
      x = m & ~(k1 | k0);
      if ((any1 & any0) !== 0) this.contention.add(n);
      else this.contention.delete(n);
    }
    v >>>= 0;
    x >>>= 0;
    if (this.netV[n] === v && this.netX[n] === x) return false;
    this.netV[n] = v;
    this.netX[n] = x;
    return true;
  }

  /** Write a source part's outputs (switch, button, const, clock, dff); returns the readers to wake. */
  private writeSourceOutputs(i: number): number[] {
    const p = this.nl.parts[i]!;
    let v: number;
    let x = 0;
    if (p.kind === 'switch' || p.kind === 'button') v = this.inputValue[i]!;
    else if (p.kind === 'const') v = p.initialValue;
    else if (p.kind === 'clock') v = this.clockLevel;
    else if (p.kind === 'dff') {
      v = this.stV[i]!;
      x = this.stX[i]!;
    } else return [];
    const s = p.outputSlots[0]!;
    this.slotV[s] = v;
    this.slotX[s] = x;
    this.slotZ[s] = 0;
    const n = this.nl.slotNet[s]!;
    return this.refreshNet(n) ? this.nl.netReaders[n]! : [];
  }
}

export function idle(): SettleResult {
  return { stable: true, unstableNets: [], contentionNets: [], events: 0 };
}
