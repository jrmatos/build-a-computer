import { Prng } from '@build-a-computer/det';
import { assertRunnable, type CompiledPart, type Netlist } from './compile';
import { idle, stateKey, type Engine, type EngineOptions, type InternalState, type SettleResult } from './engine';
import { gate, type VX2 } from './library';
import {
  K_BLOCK,
  K_BUF,
  K_CBLOCK,
  K_CLOCK,
  K_DFF,
  K_GATE,
  K_JOIN,
  K_SOURCE,
  K_SPLIT,
  K_TRI,
  R_FREE,
  R_TIMED,
  isComb,
  levelize,
  type FastProgram,
} from './levelize';
import { V0, V1, VX, allX, mask, type Signal, type Value } from './values';

/**
 * SIM-04: the fast engine. Same public API as `ReferenceEngine`, and the same
 * observable results.
 *
 * WHAT "MATCHES" MEANS. After every call (powerOn, powerOff, setSwitch,
 * setValue, press, tick) the two engines agree on:
 *   - every net value (`netV`, `netX`, `readSignal`, `readPin`),
 *   - `stable`, and `unstableNets` (as a sorted list),
 *   - `contentionNets` as a SET (this engine returns it sorted ascending; the
 *     reference returns Set insertion order, which is an artifact),
 *   - every internal state that can influence the future: output slots
 *     (value, X and Z masks), flip-flop state, last-seen clocks and block
 *     states (see `internalState`),
 *   - `ticks`, `clock`, `isPowered`, switch values, `memory`.
 * `events` is the amount of work done. It equals the reference whenever the
 * settle ran on the exact path, and is never larger than the reference on the
 * fast path (free parts switch at most once instead of glitching).
 *
 * HOW. `levelize` splits combinational parts into a TIMED region
 * (combinational loops, flip-flops clocked from logic, clocked blocks, and
 * their fan-in cones) and a FREE region (acyclic logic that nothing
 * timing-sensitive reads). A settle normally runs on the FAST path:
 *   1. The timed region (plus every flip-flop and clocked block) is simulated
 *      wave by wave with unit delay, exactly as the reference does. Timed
 *      parts never read a net with a free driver (except the D pin of
 *      clean-clock flip-flops, which only sample in the first wave), so this
 *      is identical wave for wave.
 *   2. Free parts are evaluated once each, in level order, starting from the
 *      ones whose inputs changed. For acyclic logic the settled value is the
 *      combinational function of the settled inputs, which is what the
 *      reference ends with after its glitches die out.
 * The reference counts free glitches against the event budget, so the fast
 * path must prove that the reference could not have run out of budget:
 * `timedEvents + bound(free events) <= budget`, where a free part at level L
 * switches in at most `W + L` waves (W = timed waves), each switch changing
 * at most its number of outputs, tightened if needed by counting the waves in
 * which each free part can actually be woken. If the proof fails, the timed
 * region alone exceeds the budget (an oscillation), or a clocked block sees a
 * rising edge (its state may be updated in place, so it cannot be rolled
 * back), the timed changes are rolled back from an undo log and the settle is
 * rerun on the EXACT path: a typed-array port of the reference algorithm,
 * including its post-budget scan for unstable nets and its wave ordering.
 *
 * The fast path also needs every free part to be "consistent" before the
 * settle (outputs = function of current inputs) and every flip-flop to have
 * seen its current clock, because the reference may wake a stale part on a
 * glitch that the fast path never produces. That holds after any stable
 * settle; after an unstable one (or a forced loop value at power on) the
 * engine stays on the exact path until a check shows it holds again.
 */

export interface FastStats {
  fastSettles: number;
  exactSettles: number;
  /** Fast attempts rolled back and rerun exactly. */
  fallbacks: number;
}

const U_SLOT = 0;
const U_NET = 1;
const U_CONT = 2;
const U_STATE = 3;
const U_PREV = 4;
const SAT = 1 << 30;

const bitValue = (v: number, x: number): Value => ((x & 1) !== 0 ? VX : ((v & 1) as Value));

export class FastEngine implements Engine {
  readonly netV: Uint32Array;
  readonly netX: Uint32Array;
  readonly prog: FastProgram;
  readonly stats: FastStats = { fastSettles: 0, exactSettles: 0, fallbacks: 0 };
  private readonly parts: CompiledPart[];
  private readonly netWidth: Int32Array;
  private readonly slotV: Uint32Array;
  private readonly slotX: Uint32Array;
  private readonly slotZ: Uint32Array;
  private readonly stV: Uint32Array;
  private readonly stX: Uint32Array;
  private readonly prevClk: Uint8Array;
  private readonly blockState: unknown[];
  private readonly inputValue: Uint32Array;
  private readonly cont: Uint8Array;
  private readonly clockParts: Int32Array;
  private clockLevel: Value = V0;
  private readonly budget: number;
  private readonly prng: Prng;
  private powered = false;
  private consistent = false;
  /** Set when a clocked block sees an edge during a fast settle. */
  private abort = false;
  private readonly R: VX2 = { v: 0, x: 0 };
  /** Total clock half-periods since power on. */
  ticks = 0;

  // Wave scratch.
  private cur: Int32Array;
  private nxt: Int32Array;
  private readonly partStamp: Uint32Array;
  private readonly netStamp: Uint32Array;
  private stampCounter = 0;
  private readonly chS: Int32Array;
  private readonly chV: Uint32Array;
  private readonly chX: Uint32Array;
  private readonly chZ: Uint32Array;
  private readonly netsList: Int32Array;
  private readonly lastChanged: Int32Array;

  // Free-region pass.
  private readonly fDirty: Uint8Array;
  private readonly bucket: Int32Array;
  private readonly bucketFill: Int32Array;
  private minDirty: number;
  private maxDirty = 0;

  // Wake counting for the event bound.
  private wakeEpoch = 0;
  private readonly wakeGen: Uint32Array;
  private readonly wakeLast: Int32Array;
  private readonly wakeCount: Int32Array;
  private readonly acc: Int32Array;

  // Undo log for the timed phase of a fast settle.
  private logging = false;
  private undoLen = 0;
  private undoKind = new Uint8Array(1024);
  private undoIdx = new Int32Array(1024);
  private undoA = new Uint32Array(1024);
  private undoB = new Uint32Array(1024);
  private undoC = new Uint32Array(1024);

  constructor(
    readonly nl: Netlist,
    private readonly opts: EngineOptions = {},
  ) {
    assertRunnable(nl);
    const prog = (this.prog = levelize(nl));
    this.parts = nl.parts;
    this.netWidth = nl.netWidth;
    const P = prog.partCount;
    const N = prog.netCount;
    const S = prog.slotCount;
    this.netV = new Uint32Array(N);
    this.netX = prog.netMask.slice();
    this.slotV = new Uint32Array(S);
    this.slotX = prog.slotMask.slice();
    this.slotZ = new Uint32Array(S);
    this.stV = new Uint32Array(P);
    this.stX = new Uint32Array(P).fill(1);
    this.prevClk = new Uint8Array(P).fill(VX);
    this.blockState = new Array<unknown>(P).fill(undefined);
    this.inputValue = Uint32Array.from(nl.parts, (p) => p.initialValue);
    this.cont = new Uint8Array(N);
    const clocks: number[] = [];
    for (let p = 0; p < P; p++) if (prog.kind[p] === K_CLOCK) clocks.push(p);
    this.clockParts = Int32Array.from(clocks);
    const perPart = opts.eventBudgetPerPart ?? 1000;
    this.budget = Math.min(perPart * Math.max(1, P), opts.maxEventsPerSettle ?? 5_000_000);
    this.prng = new Prng(opts.seed ?? 1);

    this.cur = new Int32Array(P);
    this.nxt = new Int32Array(P);
    this.partStamp = new Uint32Array(P);
    this.netStamp = new Uint32Array(N);
    this.chS = new Int32Array(S);
    this.chV = new Uint32Array(S);
    this.chX = new Uint32Array(S);
    this.chZ = new Uint32Array(S);
    this.netsList = new Int32Array(N);
    this.lastChanged = new Int32Array(N);

    this.fDirty = new Uint8Array(P);
    this.bucket = new Int32Array(prog.freeCount);
    this.bucketFill = new Int32Array(prog.maxLevel + 1);
    this.minDirty = prog.maxLevel + 1;

    this.wakeGen = new Uint32Array(P);
    this.wakeLast = new Int32Array(P);
    this.wakeCount = new Int32Array(P);
    this.acc = new Int32Array(P);
  }

  get isPowered(): boolean {
    return this.powered;
  }

  get clock(): Value {
    return this.clockLevel;
  }

  /** Same power-on sequence as the reference, including loop resolution. */
  powerOn(): SettleResult {
    const prog = this.prog;
    this.powered = true;
    this.ticks = 0;
    this.clockLevel = V0;
    this.clearNets();
    this.cont.fill(0);
    const random = this.opts.powerOnState === 'random';
    for (let i = 0; i < prog.partCount; i++) {
      const k = prog.kind[i];
      if (k === K_DFF) {
        this.stV[i] = random ? this.prng.nextBit() : V0;
        this.stX[i] = 0;
        this.prevClk[i] = VX;
      } else if (k === K_BLOCK || k === K_CBLOCK) {
        const p = this.parts[i]!;
        if (!(p.nonVolatile && this.blockState[i] !== undefined)) {
          this.blockState[i] = p.block!.init(p.part, random ? 'random' : 'zero', this.prng);
        }
        if (k === K_CBLOCK) this.prevClk[i] = VX;
      }
      this.writeSourceOutputs(i);
    }
    for (let n = 0; n < prog.netCount; n++) this.refresh(n);

    // Every part is in the start set, so staleness cannot matter.
    this.consistent = true;
    const all = new Int32Array(prog.partCount);
    for (let i = 0; i < all.length; i++) all[i] = i;
    let result = this.settle(all);
    if (!result.stable) return result;
    for (let i = 0; i < prog.partCount; i++) {
      if (!prog.inLoop[i] || prog.kind[i] !== K_GATE) continue;
      const s = prog.out[i]!;
      const x = this.slotX[s]!;
      if (x === 0) continue;
      const r = random ? (this.parts[i]!.width === 1 ? this.prng.nextBit() : this.prng.nextU32()) : 0;
      this.slotV[s] = (this.slotV[s]! | (r & x)) >>> 0;
      this.slotX[s] = 0;
      // A forced free gate no longer equals its function: stay exact until checked.
      if (prog.region[i] === R_FREE) this.consistent = false;
      const n = prog.slotNet[s]!;
      const changed = this.refresh(n);
      result = this.settle(changed ? prog.rd.subarray(prog.rdStart[n]!, prog.rdStart[n + 1]!) : EMPTY);
      if (!result.stable) return result;
    }
    return result;
  }

  /** Power off clears every volatile value (E-SIM-08); non-volatile blocks (ROM) keep their state. */
  powerOff(): void {
    this.powered = false;
    this.consistent = false;
    this.clearNets();
    this.stV.fill(0);
    this.stX.fill(1);
    for (let i = 0; i < this.parts.length; i++) if (!this.parts[i]!.nonVolatile) this.blockState[i] = undefined;
    this.cont.fill(0);
  }

  setSwitch(partId: string, on: boolean): SettleResult {
    return this.setInput(partId, on ? 1 : 0, 'switch');
  }

  setValue(partId: string, value: number): SettleResult {
    return this.setInput(partId, value, 'switch');
  }

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
    for (const c of this.clockParts) for (const r of this.writeSourceOutputs(c)) woken.push(r);
    // A rising edge reaches clocked blocks, which would abort the fast path anyway.
    if (this.clockLevel === V1 && this.prog.cblockCount > 0) return this.settleExact(woken);
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
    return { w: this.netWidth[n]!, v: this.netV[n]!, x: this.netX[n]! };
  }

  netValue(n: number): Value {
    return bitValue(this.netV[n]!, this.netX[n]!);
  }

  memory(partId: string): number[] {
    const i = this.nl.partIndex.get(partId);
    if (i === undefined) return [];
    const p = this.parts[i]!;
    const st = this.blockState[i];
    if (!p.block?.inspect || st === undefined) return [];
    return Array.from(p.block.inspect(st));
  }

  /** Copies of the hidden state, for differential tests. */
  internalState(): InternalState {
    return {
      slotV: this.slotV.slice(),
      slotX: this.slotX.slice(),
      slotZ: this.slotZ.slice(),
      stV: this.stV.slice(),
      stX: this.stX.slice(),
      prevClk: this.prevClk.slice(),
      blocks: this.parts.map((p, i) => (p.block ? stateKey(this.blockState[i]) : '')),
    };
  }

  // ---------------------------------------------------------------- inputs

  private setInput(partId: string, value: number, want: 'switch' | 'button'): SettleResult {
    const i = this.nl.partIndex.get(partId);
    const p = i === undefined ? undefined : this.parts[i];
    if (i === undefined || !p || (p.kind !== 'switch' && p.kind !== 'button')) {
      throw new Error(`No ${want} named ${partId}`);
    }
    this.inputValue[i] = (value & this.prog.slotMask[this.prog.out[i]!]!) >>> 0;
    if (!this.powered) return idle();
    return this.settle(this.writeSourceOutputs(i));
  }

  private clearNets(): void {
    this.netV.fill(0);
    this.netX.set(this.prog.netMask);
    this.slotV.fill(0);
    this.slotX.set(this.prog.slotMask);
    this.slotZ.fill(0);
  }

  // ---------------------------------------------------------------- settle

  private settle(start: ArrayLike<number>): SettleResult {
    if (this.prog.freeCount === 0 || !this.consistent) return this.settleExact(start);
    return this.settleFast(start);
  }

  private nextStamp(): number {
    if (this.stampCounter >= 0xfffffff0) {
      this.partStamp.fill(0);
      this.netStamp.fill(0);
      this.stampCounter = 0;
    }
    return ++this.stampCounter;
  }

  /** Record a change of slot `s` at index `ch` when it differs; returns the new count. */
  private push(ch: number, s: number, v: number, x: number, z: number): number {
    if (this.slotV[s] === v && this.slotX[s] === x && this.slotZ[s] === z) return ch;
    this.chS[ch] = s;
    this.chV[ch] = v;
    this.chX[ch] = x;
    this.chZ[ch] = z;
    return ch + 1;
  }

  private inputSignals(p: number): Signal[] {
    const { inStart, inNet } = this.prog;
    const res: Signal[] = [];
    for (let j = inStart[p]!; j < inStart[p + 1]!; j++) {
      const n = inNet[j]!;
      res.push({ w: this.netWidth[n]!, v: this.netV[n]!, x: this.netX[n]! });
    }
    return res;
  }

  private pushBlockOutputs(p: number, ins: Signal[], ch: number): number {
    const part = this.parts[p]!;
    const outs = part.block!.outputs(ins, this.blockState[p], part.part);
    const { out, nOut, slotMask } = this.prog;
    for (let k = 0; k < nOut[p]!; k++) {
      const s = out[p]! + k;
      const m = slotMask[s]!;
      const o = outs[k];
      const x = o ? (o.x & m) >>> 0 : m;
      ch = this.push(ch, s, o ? (o.v & ~x & m) >>> 0 : 0, x, 0);
    }
    return ch;
  }

  /**
   * Evaluate part `p` against the current nets and record its output changes
   * from index `ch`. Combinational parts have no side effects; flip-flops and
   * clocked blocks update their state (logged during fast settles).
   */
  private evalPart(p: number, ch: number): number {
    const prog = this.prog;
    const netV = this.netV;
    const netX = this.netX;
    switch (prog.kind[p]) {
      case K_GATE: {
        const a = prog.in0[p]!;
        const b = prog.in1[p]!;
        const s = prog.out[p]!;
        const R = this.R;
        gate(prog.op[p]!, netV[a]!, netX[a]!, netV[b]!, netX[b]!, prog.slotMask[s]!, R);
        return this.push(ch, s, R.v, R.x, 0);
      }
      case K_BUF: {
        const a = prog.in0[p]!;
        return this.push(ch, prog.out[p]!, netV[a]!, netX[a]!, 0);
      }
      case K_TRI: {
        const a = prog.in0[p]!;
        const e = prog.in1[p]!;
        const s = prog.out[p]!;
        const m = prog.slotMask[s]!;
        if (netX[e]! & 1) return this.push(ch, s, 0, m, 0);
        if (netV[e]! & 1) return this.push(ch, s, netV[a]!, netX[a]!, 0);
        return this.push(ch, s, 0, 0, m);
      }
      case K_SPLIT: {
        const a = prog.in0[p]!;
        const c = prog.chunk[p]!;
        const cm = mask(c);
        const av = netV[a]!;
        const ax = netX[a]!;
        const s0 = prog.out[p]!;
        for (let k = 0; k < prog.nOut[p]!; k++) {
          const sh = k * c;
          ch = this.push(ch, s0 + k, ((av >>> sh) & cm) >>> 0, ((ax >>> sh) & cm) >>> 0, 0);
        }
        return ch;
      }
      case K_JOIN: {
        const c = prog.chunk[p]!;
        const cm = mask(c);
        let v = 0;
        let x = 0;
        const j0 = prog.inStart[p]!;
        for (let j = j0; j < prog.inStart[p + 1]!; j++) {
          const n = prog.inNet[j]!;
          const sh = (j - j0) * c;
          v |= (netV[n]! & cm) << sh;
          x |= (netX[n]! & cm) << sh;
        }
        return this.push(ch, prog.out[p]!, v >>> 0, x >>> 0, 0);
      }
      case K_DFF: {
        const d = prog.in0[p]!;
        const c = prog.in1[p]!;
        const clk = bitValue(netV[c]!, netX[c]!);
        if (this.prevClk[p] === V0 && clk === V1) this.setState(p, netV[d]! & 1, netX[d]! & 1);
        if (this.prevClk[p] !== clk) this.setPrev(p, clk);
        return this.push(ch, prog.out[p]!, this.stV[p]!, this.stX[p]!, 0);
      }
      case K_BLOCK:
        return this.pushBlockOutputs(p, this.inputSignals(p), ch);
      case K_CBLOCK: {
        const ins = this.inputSignals(p);
        const c = ins[prog.clkIn[p]!]!;
        const clk = bitValue(c.v, c.x);
        if (this.prevClk[p] === V0 && clk === V1) {
          if (this.logging) {
            this.abort = true;
            return ch;
          }
          const part = this.parts[p]!;
          this.blockState[p] = part.block!.clock!(ins, this.blockState[p], part.part);
        }
        if (this.prevClk[p] !== clk) this.setPrev(p, clk);
        return this.pushBlockOutputs(p, ins, ch);
      }
      default:
        return ch;
    }
  }

  /** Evaluate the parts in `cur[0..len)` and record output changes. Returns the number of changes. */
  private evalWave(len: number): number {
    const cur = this.cur;
    let ch = 0;
    for (let i = 0; i < len; i++) {
      ch = this.evalPart(cur[i]!, ch);
      if (this.abort) return ch;
    }
    return ch;
  }

  /** Apply wave changes; fills netsList (deduplicated, in order) and returns its length. */
  private applyWave(ch: number, w: number): number {
    const slotNet = this.prog.slotNet;
    const netStamp = this.netStamp;
    const netsList = this.netsList;
    let len = 0;
    for (let k = 0; k < ch; k++) {
      const s = this.chS[k]!;
      if (this.logging) this.log(U_SLOT, s, this.slotV[s]!, this.slotX[s]!, this.slotZ[s]!);
      this.slotV[s] = this.chV[k]!;
      this.slotX[s] = this.chX[k]!;
      this.slotZ[s] = this.chZ[k]!;
      const n = slotNet[s]!;
      if (netStamp[n] !== w) {
        netStamp[n] = w;
        netsList[len++] = n;
      }
    }
    return len;
  }

  /** The reference algorithm on typed arrays: every part, wave by wave. */
  private settleExact(start: ArrayLike<number>): SettleResult {
    this.stats.exactSettles++;
    const { rdStart, rd } = this.prog;
    const partStamp = this.partStamp;
    let curLen = 0;
    const w0 = this.nextStamp();
    for (let i = 0; i < start.length; i++) {
      const p = start[i]!;
      if (partStamp[p] !== w0) {
        partStamp[p] = w0;
        this.cur[curLen++] = p;
      }
    }
    let events = 0;
    let lastLen: number;
    while (curLen) {
      const ch = this.evalWave(curLen);
      const w = this.nextStamp();
      const nlen = this.applyWave(ch, w);
      let nextLen = 0;
      lastLen = 0;
      const nxt = this.nxt;
      for (let j = 0; j < nlen; j++) {
        const n = this.netsList[j]!;
        if (!this.refresh(n)) continue;
        this.lastChanged[lastLen++] = n;
        for (let k = rdStart[n]!; k < rdStart[n + 1]!; k++) {
          const r = rd[k]!;
          if (partStamp[r] !== w) {
            partStamp[r] = w;
            nxt[nextLen++] = r;
          }
        }
      }
      events += ch;
      this.nxt = this.cur;
      this.cur = nxt;
      curLen = nextLen;
      if (events > this.budget && curLen) {
        const unstableNets = this.collectUnstable(curLen, lastLen);
        this.afterExact();
        return { stable: false, unstableNets, contentionNets: this.contentionList(), events };
      }
    }
    this.afterExact();
    return { stable: true, unstableNets: [], contentionNets: this.contentionList(), events };
  }

  private afterExact(): void {
    if (this.prog.freeCount > 0) this.consistent = this.checkConsistent();
  }

  /** Same as the reference: up to 64 more waves of combinational parts, listing every net that moves. */
  private collectUnstable(curLen: number, lastLen: number): number[] {
    const { kind, slotNet, rdStart, rd } = this.prog;
    const moving = new Set<number>();
    for (let i = 0; i < lastLen; i++) moving.add(this.lastChanged[i]!);
    let waveLen = curLen;
    for (let k = 0; k < 64 && waveLen; k++) {
      let ch = 0;
      for (let i = 0; i < waveLen; i++) {
        const p = this.cur[i]!;
        if (isComb(kind[p]!)) ch = this.evalPart(p, ch);
      }
      const w = this.nextStamp();
      let nextLen = 0;
      const nxt = this.nxt;
      for (let j = 0; j < ch; j++) {
        const s = this.chS[j]!;
        this.slotV[s] = this.chV[j]!;
        this.slotX[s] = this.chX[j]!;
        this.slotZ[s] = this.chZ[j]!;
        const n = slotNet[s]!;
        if (!this.refresh(n)) continue;
        moving.add(n);
        for (let q = rdStart[n]!; q < rdStart[n + 1]!; q++) {
          const r = rd[q]!;
          if (this.partStamp[r] !== w) {
            this.partStamp[r] = w;
            nxt[nextLen++] = r;
          }
        }
      }
      this.nxt = this.cur;
      this.cur = nxt;
      waveLen = nextLen;
    }
    return [...moving].sort((a, b) => a - b);
  }

  /** Timed region wave by wave, then the free region in level order. */
  private settleFast(start: ArrayLike<number>): SettleResult {
    const prog = this.prog;
    const { region, tRdStart, tRd, fRdStart, fRd } = prog;
    const partStamp = this.partStamp;
    this.wakeEpoch = (this.wakeEpoch + 1) >>> 0 || 1;
    this.logging = true;
    this.undoLen = 0;

    let curLen = 0;
    const w0 = this.nextStamp();
    for (let i = 0; i < start.length; i++) {
      const p = start[i]!;
      const r = region[p];
      if (r === R_TIMED) {
        if (partStamp[p] !== w0) {
          partStamp[p] = w0;
          this.cur[curLen++] = p;
        }
      } else if (r === R_FREE) {
        this.markFree(p);
        this.noteWake(p, 1);
      }
    }

    let eT = 0;
    let waves = 0;
    while (curLen) {
      waves++;
      const ch = this.evalWave(curLen);
      if (this.abort) return this.fallback(start);
      const w = this.nextStamp();
      const nlen = this.applyWave(ch, w);
      let nextLen = 0;
      const nxt = this.nxt;
      for (let j = 0; j < nlen; j++) {
        const n = this.netsList[j]!;
        const changed = this.refresh(n);
        for (let k = fRdStart[n]!; k < fRdStart[n + 1]!; k++) {
          const r = fRd[k]!;
          // A timed driver switched: in the reference this net may move now.
          this.noteWake(r, waves + 1);
          if (changed) this.markFree(r);
        }
        if (!changed) continue;
        for (let k = tRdStart[n]!; k < tRdStart[n + 1]!; k++) {
          const r = tRd[k]!;
          if (partStamp[r] !== w) {
            partStamp[r] = w;
            nxt[nextLen++] = r;
          }
        }
      }
      eT += ch;
      this.nxt = this.cur;
      this.cur = nxt;
      curLen = nextLen;
      if (eT > this.budget) return this.fallback(start);
    }

    const cheap = eT + prog.freeSlots * waves + prog.sumLevelSlots;
    if (cheap > this.budget && !this.tightBound(eT, waves)) return this.fallback(start);

    this.logging = false;
    const eF = this.freePass();
    this.stats.fastSettles++;
    return { stable: true, unstableNets: [], contentionNets: this.contentionList(), events: eT + eF };
  }

  private fallback(start: ArrayLike<number>): SettleResult {
    this.stats.fallbacks++;
    this.logging = false;
    this.abort = false;
    for (let i = this.undoLen - 1; i >= 0; i--) {
      const idx = this.undoIdx[i]!;
      const a = this.undoA[i]!;
      switch (this.undoKind[i]) {
        case U_SLOT:
          this.slotV[idx] = a;
          this.slotX[idx] = this.undoB[i]!;
          this.slotZ[idx] = this.undoC[i]!;
          break;
        case U_NET:
          this.netV[idx] = a;
          this.netX[idx] = this.undoB[i]!;
          break;
        case U_CONT:
          this.cont[idx] = a;
          break;
        case U_STATE:
          this.stV[idx] = a;
          this.stX[idx] = this.undoB[i]!;
          break;
        default:
          this.prevClk[idx] = a;
      }
    }
    this.undoLen = 0;
    this.clearFree();
    return this.settleExact(start);
  }

  /**
   * Upper bound on free-part events in the reference, tighter than the cheap
   * one: a free part switches at most once per wave in which it is woken, it
   * is woken by timed drivers in the waves counted in `wakeCount`, and by a
   * free driver at most as often as that driver switches. Each switch changes
   * at most all of the part's outputs.
   */
  private tightBound(eT: number, waves: number): boolean {
    const { order, level, out, nOut, slotNet, fRdStart, fRd } = this.prog;
    const acc = this.acc;
    acc.fill(0);
    let total = eT;
    for (let i = 0; i < order.length; i++) {
      const p = order[i]!;
      let b = acc[p]! + (this.wakeGen[p] === this.wakeEpoch ? this.wakeCount[p]! : 0);
      const cap = waves + level[p]!;
      if (b > cap) b = cap;
      if (b === 0) continue;
      total += b * nOut[p]!;
      if (total > this.budget) return false;
      for (let s = out[p]!; s < out[p]! + nOut[p]!; s++) {
        const n = slotNet[s]!;
        for (let k = fRdStart[n]!; k < fRdStart[n + 1]!; k++) {
          const r = fRd[k]!;
          const v = acc[r]! + b;
          acc[r] = v > SAT ? SAT : v;
        }
      }
    }
    return true;
  }

  private noteWake(p: number, wave: number): void {
    if (this.wakeGen[p] !== this.wakeEpoch) {
      this.wakeGen[p] = this.wakeEpoch;
      this.wakeCount[p] = 1;
      this.wakeLast[p] = wave;
    } else if (this.wakeLast[p] !== wave) {
      this.wakeCount[p]!++;
      this.wakeLast[p] = wave;
    }
  }

  private markFree(p: number): void {
    if (this.fDirty[p]) return;
    this.fDirty[p] = 1;
    const L = this.prog.level[p]!;
    this.bucket[this.prog.levelStart[L - 1]! + this.bucketFill[L]!++] = p;
    if (L < this.minDirty) this.minDirty = L;
    if (L > this.maxDirty) this.maxDirty = L;
  }

  private clearFree(): void {
    const { levelStart } = this.prog;
    for (let L = this.minDirty; L <= this.maxDirty; L++) {
      const base = levelStart[L - 1]!;
      for (let i = 0; i < this.bucketFill[L]!; i++) this.fDirty[this.bucket[base + i]!] = 0;
      this.bucketFill[L] = 0;
    }
    this.minDirty = this.prog.maxLevel + 1;
    this.maxDirty = 0;
  }

  /** Evaluate dirty free parts once each, in level order. Returns events. */
  private freePass(): number {
    const { slotNet, levelStart, fRdStart, fRd } = this.prog;
    let events = 0;
    for (let L = this.minDirty; L <= this.maxDirty; L++) {
      const base = levelStart[L - 1]!;
      const fill = this.bucketFill[L]!;
      for (let i = 0; i < fill; i++) {
        const p = this.bucket[base + i]!;
        this.fDirty[p] = 0;
        const ch = this.evalPart(p, 0);
        for (let k = 0; k < ch; k++) {
          const s = this.chS[k]!;
          this.slotV[s] = this.chV[k]!;
          this.slotX[s] = this.chX[k]!;
          this.slotZ[s] = this.chZ[k]!;
          events++;
          const n = slotNet[s]!;
          if (!this.refresh(n)) continue;
          for (let q = fRdStart[n]!; q < fRdStart[n + 1]!; q++) this.markFree(fRd[q]!);
        }
      }
      this.bucketFill[L] = 0;
    }
    this.minDirty = this.prog.maxLevel + 1;
    this.maxDirty = 0;
    return events;
  }

  /**
   * Free parts equal their function and flip-flops have seen their clock.
   * (Clocked blocks never read free nets, so a free glitch cannot wake them.)
   */
  private checkConsistent(): boolean {
    const { kind, region, in1, out } = this.prog;
    for (let p = 0; p < this.prog.partCount; p++) {
      if (region[p] === R_FREE) {
        if (this.evalPart(p, 0) !== 0) return false;
      } else if (kind[p] === K_DFF) {
        const c = in1[p]!;
        if (this.prevClk[p] !== bitValue(this.netV[c]!, this.netX[c]!)) return false;
        const s = out[p]!;
        if (this.slotV[s] !== this.stV[p] || this.slotX[s] !== this.stX[p] || this.slotZ[s] !== 0) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- nets

  private log(kind: number, idx: number, a: number, b = 0, c = 0): void {
    if (this.undoLen === this.undoKind.length) {
      const grow = <T extends Uint8Array | Int32Array | Uint32Array>(arr: T, make: (n: number) => T): T => {
        const r = make(arr.length * 2);
        r.set(arr);
        return r;
      };
      this.undoKind = grow(this.undoKind, (n) => new Uint8Array(n));
      this.undoIdx = grow(this.undoIdx, (n) => new Int32Array(n));
      this.undoA = grow(this.undoA, (n) => new Uint32Array(n));
      this.undoB = grow(this.undoB, (n) => new Uint32Array(n));
      this.undoC = grow(this.undoC, (n) => new Uint32Array(n));
    }
    const i = this.undoLen++;
    this.undoKind[i] = kind;
    this.undoIdx[i] = idx;
    this.undoA[i] = a;
    this.undoB[i] = b;
    this.undoC[i] = c;
  }

  private setState(p: number, v: number, x: number): void {
    if (this.stV[p] === v && this.stX[p] === x) return;
    if (this.logging) this.log(U_STATE, p, this.stV[p]!, this.stX[p]!);
    this.stV[p] = v;
    this.stX[p] = x;
  }

  private setPrev(p: number, v: number): void {
    if (this.logging) this.log(U_PREV, p, this.prevClk[p]!);
    this.prevClk[p] = v;
  }

  /** Recompute a net from its drivers (same rule as the reference); returns true when its value changed. */
  private refresh(n: number): boolean {
    const { drvStart, drv, netMask } = this.prog;
    const a = drvStart[n]!;
    const b = drvStart[n + 1]!;
    const m = netMask[n]!;
    let v: number;
    let x: number;
    if (b - a === 1) {
      const s = drv[a]!;
      x = (this.slotX[s]! | this.slotZ[s]!) & m;
      v = this.slotV[s]! & m & ~x;
    } else if (a === b) {
      v = 0;
      x = m;
    } else {
      let any1 = 0;
      let any0 = 0;
      let anyX = 0;
      for (let k = a; k < b; k++) {
        const s = drv[k]!;
        const sv = this.slotV[s]!;
        const sx = this.slotX[s]!;
        const d = ~this.slotZ[s]! & m;
        any1 |= sv & d;
        anyX |= sx & d;
        any0 |= ~(sv | sx) & d;
      }
      const k1 = any1 & ~any0 & ~anyX;
      const k0 = any0 & ~any1 & ~anyX;
      v = k1;
      x = m & ~(k1 | k0);
      const clash = (any1 & any0) !== 0 ? 1 : 0;
      if (this.cont[n] !== clash) {
        if (this.logging) this.log(U_CONT, n, this.cont[n]!);
        this.cont[n] = clash;
      }
    }
    v >>>= 0;
    x >>>= 0;
    if (this.netV[n] === v && this.netX[n] === x) return false;
    if (this.logging) this.log(U_NET, n, this.netV[n]!, this.netX[n]!);
    this.netV[n] = v;
    this.netX[n] = x;
    return true;
  }

  private contentionList(): number[] {
    const res: number[] = [];
    for (const n of this.prog.multiNets) if (this.cont[n]) res.push(n);
    return res;
  }

  /** Write a source part's outputs; returns the readers to wake. */
  private writeSourceOutputs(i: number): Int32Array {
    const prog = this.prog;
    const k = prog.kind[i];
    let v: number;
    let x = 0;
    if (k === K_SOURCE) v = this.parts[i]!.kind === 'const' ? this.parts[i]!.initialValue : this.inputValue[i]!;
    else if (k === K_CLOCK) v = this.clockLevel;
    else if (k === K_DFF) {
      v = this.stV[i]!;
      x = this.stX[i]!;
    } else return EMPTY;
    const s = prog.out[i]!;
    this.slotV[s] = v;
    this.slotX[s] = x;
    this.slotZ[s] = 0;
    const n = prog.slotNet[s]!;
    return this.refresh(n) ? prog.rd.subarray(prog.rdStart[n]!, prog.rdStart[n + 1]!) : EMPTY;
  }
}

const EMPTY = new Int32Array(0);
