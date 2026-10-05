import { Prng } from '@ground-up/det';
import type { Netlist } from './compile';
import { V0, V1, VX, type Value } from './values';

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
  /** Nets with two drivers disagreeing (E-SIM-02). */
  contentionNets: number[];
  events: number;
}

/**
 * Reference engine: plain event-driven simulation with unit gate delay.
 * Every part whose inputs changed is evaluated in one wave; their output
 * changes land together and wake the readers for the next wave.
 * Slow and simple on purpose; the fast engine (SIM-04) is fuzzed against it.
 */
export class ReferenceEngine {
  readonly net: Uint8Array;
  private readonly slot: Uint8Array;
  private readonly dffState: Uint8Array;
  private readonly dffPrevClk: Uint8Array;
  private readonly switchOn: Uint8Array;
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
    this.net = new Uint8Array(nl.netCount).fill(VX);
    this.slot = new Uint8Array(nl.slotNet.length).fill(VX);
    this.dffState = new Uint8Array(nl.parts.length).fill(VX);
    this.dffPrevClk = new Uint8Array(nl.parts.length).fill(VX);
    this.switchOn = Uint8Array.from(nl.parts, (p) => (p.initialOn ? 1 : 0));
    const perPart = opts.eventBudgetPerPart ?? 1000;
    this.budget = Math.min(perPart * Math.max(1, nl.parts.length), opts.maxEventsPerSettle ?? 5_000_000);
    this.prng = new Prng(opts.seed ?? 1);
  }

  get isPowered(): boolean {
    return this.powered;
  }

  /**
   * Power on: volatile state starts at 0 or seeded random, then settles.
   * Feedback loops left at X are resolved one net at a time, the way a real
   * circuit falls into one stable state (an SR latch picks a side; a NOT
   * ring keeps oscillating and is reported unstable).
   */
  powerOn(): SettleResult {
    this.powered = true;
    this.ticks = 0;
    this.clockLevel = V0;
    this.net.fill(VX);
    this.slot.fill(VX);
    this.contention.clear();
    const random = this.opts.powerOnState === 'random';
    this.nl.parts.forEach((p, i) => {
      if (p.behavior.kind === 'dff') {
        this.dffState[i] = random ? this.prng.nextBit() : V0;
        this.dffPrevClk[i] = VX;
      }
      this.writeSourceOutputs(i);
    });
    for (let n = 0; n < this.nl.netCount; n++) this.net[n] = this.resolveNet(n);

    let result = this.settle(this.allParts());
    if (!result.stable) return result;
    for (let i = 0; i < this.nl.parts.length; i++) {
      const p = this.nl.parts[i]!;
      if (!p.inLoop || p.behavior.kind !== 'gate') continue;
      const s = p.outputSlots[0]!;
      if (this.slot[s] !== VX) continue;
      this.slot[s] = random ? this.prng.nextBit() : V0;
      const changed = this.refreshNet(this.nl.slotNet[s]!);
      result = this.settle(changed ? this.nl.netReaders[this.nl.slotNet[s]!]! : []);
      if (!result.stable) return result;
    }
    return result;
  }

  /** Power off clears every volatile value (E-SIM-08). */
  powerOff(): void {
    this.powered = false;
    this.net.fill(VX);
    this.slot.fill(VX);
    this.dffState.fill(VX);
    this.contention.clear();
  }

  setSwitch(partId: string, on: boolean): SettleResult {
    const i = this.nl.partIndex.get(partId);
    if (i === undefined || this.nl.parts[i]!.behavior.kind !== 'switch') {
      throw new Error(`No switch named ${partId}`);
    }
    this.switchOn[i] = on ? 1 : 0;
    if (!this.powered) return this.idle();
    return this.settle(this.writeSourceOutputs(i));
  }

  isSwitchOn(partId: string): boolean {
    const i = this.nl.partIndex.get(partId);
    return i !== undefined && this.switchOn[i] === 1;
  }

  /** Advance the global clock by half a period: one tick. */
  tick(): SettleResult {
    if (!this.powered) return this.idle();
    this.ticks++;
    this.clockLevel = this.clockLevel === V1 ? V0 : V1;
    const woken: number[] = [];
    this.nl.parts.forEach((p, i) => {
      if (p.behavior.kind === 'clock') woken.push(...this.writeSourceOutputs(i));
    });
    return this.settle(woken);
  }

  get clock(): Value {
    return this.clockLevel;
  }

  readPin(partId: string, pin: string): Value {
    const n = this.nl.pinNet.get(`${partId}:${pin}`);
    return n === undefined ? VX : (this.net[n] as Value);
  }

  /** Settle until no events remain or the budget runs out. */
  private settle(start: Iterable<number>): SettleResult {
    let dirty = new Set(start);
    let events = 0;
    let lastChanged: number[];
    while (dirty.size) {
      const changedSlots: [number, Value][] = [];
      for (const pi of dirty) {
        const p = this.nl.parts[pi]!;
        const b = p.behavior;
        if (b.kind === 'gate') {
          const v = b.eval(p.inputNets.map((n) => this.net[n]!));
          const s = p.outputSlots[0]!;
          if (this.slot[s] !== v) changedSlots.push([s, v]);
        } else if (b.kind === 'dff') {
          const d = this.net[p.inputNets[0]!]!;
          const clk = this.net[p.inputNets[1]!]!;
          if (this.dffPrevClk[pi] === V0 && clk === V1) this.dffState[pi] = d;
          this.dffPrevClk[pi] = clk;
          const s = p.outputSlots[0]!;
          if (this.slot[s] !== this.dffState[pi]) changedSlots.push([s, this.dffState[pi] as Value]);
        }
      }
      // All outputs of this wave change together (unit delay).
      const nets = new Set<number>();
      for (const [s, v] of changedSlots) {
        this.slot[s] = v;
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
      events += changedSlots.length;
      dirty = next;
      if (events > this.budget && dirty.size) {
        return { stable: false, unstableNets: this.collectUnstable(dirty, lastChanged), contentionNets: [...this.contention], events };
      }
    }
    return { stable: true, unstableNets: [], contentionNets: [...this.contention], events };
  }

  /** Run a few more waves after the budget to list every net still moving. */
  private collectUnstable(dirty: Set<number>, seed: number[]): number[] {
    const moving = new Set(seed);
    let wave = dirty;
    for (let k = 0; k < 64 && wave.size; k++) {
      const changed: [number, Value][] = [];
      for (const pi of wave) {
        const p = this.nl.parts[pi]!;
        if (p.behavior.kind !== 'gate') continue;
        const v = p.behavior.eval(p.inputNets.map((n) => this.net[n]!));
        const s = p.outputSlots[0]!;
        if (this.slot[s] !== v) changed.push([s, v]);
      }
      const next = new Set<number>();
      for (const [s, v] of changed) {
        this.slot[s] = v;
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
    const v = this.resolveNet(n);
    if (this.net[n] === v) return false;
    this.net[n] = v;
    return true;
  }

  private resolveNet(n: number): Value {
    const drivers = this.nl.netDrivers[n]!;
    if (drivers.length === 0) return VX;
    let v = this.slot[drivers[0]!] as Value;
    let clash = false;
    for (let k = 1; k < drivers.length; k++) {
      const d = this.slot[drivers[k]!] as Value;
      if (d !== v) {
        if (d !== VX && v !== VX) clash = true;
        v = VX;
      }
    }
    if (clash) this.contention.add(n);
    else this.contention.delete(n);
    return v;
  }

  /** Write a source part's outputs; returns the readers to wake. */
  private writeSourceOutputs(i: number): number[] {
    const p = this.nl.parts[i]!;
    let v: Value | undefined;
    if (p.behavior.kind === 'switch') v = this.switchOn[i] ? V1 : V0;
    else if (p.behavior.kind === 'clock') v = this.clockLevel;
    else if (p.behavior.kind === 'dff') v = this.dffState[i] as Value;
    if (v === undefined) return [];
    const s = p.outputSlots[0]!;
    this.slot[s] = v;
    const n = this.nl.slotNet[s]!;
    return this.refreshNet(n) ? this.nl.netReaders[n]! : [];
  }

  private allParts(): number[] {
    return this.nl.parts.map((_, i) => i);
  }

  private idle(): SettleResult {
    return { stable: true, unstableNets: [], contentionNets: [], events: 0 };
  }
}
