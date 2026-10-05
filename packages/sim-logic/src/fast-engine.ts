import { Prng } from '@ground-up/det';
import type { Netlist } from './compile';
import type { EngineOptions, SettleResult } from './engine';
import { K_CLOCK, K_DFF, K_GATE, K_SWITCH, R_FREE, R_TIMED, levelize, type FastProgram } from './levelize';
import { V0, V1, VX, type Value } from './values';

/**
 * SIM-04: the fast engine. Same public API as `ReferenceEngine`, and the same
 * observable results.
 *
 * WHAT "MATCHES" MEANS. After every call (powerOn, powerOff, setSwitch, tick)
 * the two engines agree on:
 *   - every net value (`net`, `readPin`),
 *   - `stable`, and `unstableNets` (as a sorted list),
 *   - `contentionNets` as a SET (this engine returns it sorted ascending; the
 *     reference returns Set insertion order, which is an artifact),
 *   - every internal state bit that can influence the future: output slots,
 *     flip-flop state and last-seen clock (see `internalState`),
 *   - `ticks`, `clock`, `isPowered`, `isSwitchOn`.
 * `events` is the amount of work done. It equals the reference whenever the
 * settle ran on the exact path, and is never larger than the reference on the
 * fast path (free gates switch at most once instead of glitching).
 *
 * HOW. `levelize` splits gates into a TIMED region (combinational loops,
 * flip-flops clocked from logic, and their fan-in cones) and a FREE region
 * (acyclic gates that nothing timing-sensitive reads). A settle normally runs
 * on the FAST path:
 *   1. The timed region (plus every flip-flop) is simulated wave by wave with
 *      unit delay, exactly as the reference does. Timed parts never read a
 *      net with a free driver, so this is identical wave for wave. Glitches,
 *      races, latch decisions and flip-flop edges therefore all match.
 *   2. Free gates are evaluated once each, in level order, starting from the
 *      ones whose inputs changed. For acyclic logic the settled value is the
 *      combinational function of the settled inputs, which is what the
 *      reference ends with after its glitches die out.
 * The reference counts free-gate glitches against the event budget, so the
 * fast path must prove that the reference could not have run out of budget:
 * `timedEvents + bound(free events) <= budget`, where a free gate at level L
 * switches at most `W + L` times (W = timed waves), tightened if needed by
 * counting the waves in which each free gate can actually be woken. If the
 * proof fails, or the timed region alone exceeds the budget (an oscillation),
 * the timed changes are rolled back from an undo log and the settle is rerun
 * on the EXACT path: a typed-array port of the reference algorithm, including
 * its post-budget scan for unstable nets and its wave ordering.
 *
 * The fast path also needs every free gate to be "consistent" before the
 * settle (output = function of current inputs) and every flip-flop to have
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

export interface InternalState {
  slot: Uint8Array;
  dffState: Uint8Array;
  dffPrevClk: Uint8Array;
}

const U_SLOT = 0;
const U_NET = 1;
const U_CONT = 2;
const U_STATE = 3;
const U_PREV = 4;
const SAT = 1 << 30;

export class FastEngine {
  readonly net: Uint8Array;
  readonly prog: FastProgram;
  readonly stats: FastStats = { fastSettles: 0, exactSettles: 0, fallbacks: 0 };
  private readonly slot: Uint8Array;
  private readonly dffState: Uint8Array;
  private readonly dffPrevClk: Uint8Array;
  private readonly switchOn: Uint8Array;
  private readonly cont: Uint8Array;
  private readonly clockParts: Int32Array;
  private clockLevel: Value = V0;
  private readonly budget: number;
  private readonly prng: Prng;
  private powered = false;
  private consistent = false;
  /** Total clock half-periods since power on. */
  ticks = 0;

  // Wave scratch.
  private cur: Int32Array;
  private nxt: Int32Array;
  private readonly partStamp: Uint32Array;
  private readonly netStamp: Uint32Array;
  private stampCounter = 0;
  private readonly chS: Int32Array;
  private readonly chV: Uint8Array;
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
  private undoOld = new Uint8Array(1024);

  constructor(
    readonly nl: Netlist,
    private readonly opts: EngineOptions = {},
  ) {
    const prog = (this.prog = levelize(nl));
    const P = prog.partCount;
    const N = prog.netCount;
    this.net = new Uint8Array(N).fill(VX);
    this.slot = new Uint8Array(prog.slotCount).fill(VX);
    this.dffState = new Uint8Array(P).fill(VX);
    this.dffPrevClk = new Uint8Array(P).fill(VX);
    this.switchOn = Uint8Array.from(nl.parts, (p) => (p.initialOn ? 1 : 0));
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
    this.chS = new Int32Array(P);
    this.chV = new Uint8Array(P);
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
    this.net.fill(VX);
    this.slot.fill(VX);
    this.cont.fill(0);
    const random = this.opts.powerOnState === 'random';
    for (let i = 0; i < prog.partCount; i++) {
      if (prog.kind[i] === K_DFF) {
        this.dffState[i] = random ? this.prng.nextBit() : V0;
        this.dffPrevClk[i] = VX;
      }
      this.writeSourceOutputs(i);
    }
    for (let n = 0; n < prog.netCount; n++) this.net[n] = this.resolve(n);

    // Every part is in the start set, so staleness cannot matter.
    this.consistent = true;
    const all = new Int32Array(prog.partCount);
    for (let i = 0; i < all.length; i++) all[i] = i;
    let result = this.settle(all);
    if (!result.stable) return result;
    for (let i = 0; i < prog.partCount; i++) {
      if (!prog.inLoop[i] || prog.kind[i] !== K_GATE) continue;
      const s = prog.out[i]!;
      if (this.slot[s] !== VX) continue;
      this.slot[s] = random ? this.prng.nextBit() : V0;
      // A forced free gate no longer equals its function: stay exact until checked.
      if (prog.region[i] === R_FREE) this.consistent = false;
      const n = prog.slotNet[s]!;
      const changed = this.refresh(n);
      result = this.settle(changed ? prog.rd.subarray(prog.rdStart[n]!, prog.rdStart[n + 1]!) : new Int32Array(0));
      if (!result.stable) return result;
    }
    return result;
  }

  /** Power off clears every volatile value (E-SIM-08). */
  powerOff(): void {
    this.powered = false;
    this.consistent = false;
    this.net.fill(VX);
    this.slot.fill(VX);
    this.dffState.fill(VX);
    this.cont.fill(0);
  }

  setSwitch(partId: string, on: boolean): SettleResult {
    const i = this.nl.partIndex.get(partId);
    if (i === undefined || this.prog.kind[i] !== K_SWITCH) {
      throw new Error(`No switch named ${partId}`);
    }
    this.switchOn[i] = on ? 1 : 0;
    if (!this.powered) return idle();
    return this.settle(this.writeSourceOutputs(i));
  }

  isSwitchOn(partId: string): boolean {
    const i = this.nl.partIndex.get(partId);
    return i !== undefined && this.switchOn[i] === 1;
  }

  /** Advance the global clock by half a period: one tick. */
  tick(): SettleResult {
    if (!this.powered) return idle();
    this.ticks++;
    this.clockLevel = this.clockLevel === V1 ? V0 : V1;
    const woken: number[] = [];
    for (const c of this.clockParts) for (const r of this.writeSourceOutputs(c)) woken.push(r);
    return this.settle(woken);
  }

  readPin(partId: string, pin: string): Value {
    const n = this.nl.pinNet.get(`${partId}:${pin}`);
    return n === undefined ? VX : (this.net[n] as Value);
  }

  /** Copies of the hidden state, for differential tests. */
  internalState(): InternalState {
    return { slot: this.slot.slice(), dffState: this.dffState.slice(), dffPrevClk: this.dffPrevClk.slice() };
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

  /**
   * Evaluate the parts in `cur[0..len)` (gates and flip-flops) and record
   * output changes in chS/chV. Returns the number of changes.
   */
  private evalWave(len: number): number {
    const { kind, gate, gateTable, in0, in1, out } = this.prog;
    const net = this.net;
    const slot = this.slot;
    const cur = this.cur;
    const chS = this.chS;
    const chV = this.chV;
    let ch = 0;
    for (let i = 0; i < len; i++) {
      const p = cur[i]!;
      const k = kind[p]!;
      if (k === K_GATE) {
        const v = gateTable[gate[p]! * 9 + net[in0[p]!]! * 3 + net[in1[p]!]!]!;
        const s = out[p]!;
        if (slot[s] !== v) {
          chS[ch] = s;
          chV[ch++] = v;
        }
      } else if (k === K_DFF) {
        const d = net[in0[p]!]!;
        const clk = net[in1[p]!]!;
        if (this.dffPrevClk[p] === V0 && clk === V1) this.setState(p, d);
        if (this.dffPrevClk[p] !== clk) this.setPrev(p, clk);
        const s = out[p]!;
        const st = this.dffState[p]!;
        if (slot[s] !== st) {
          chS[ch] = s;
          chV[ch++] = st;
        }
      }
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
      if (this.logging) this.log(U_SLOT, s, this.slot[s]!);
      this.slot[s] = this.chV[k]!;
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

  /** Same as the reference: up to 64 more waves of gates, slot by slot, listing every net that moves. */
  private collectUnstable(curLen: number, lastLen: number): number[] {
    const { kind, gate, gateTable, in0, in1, out, slotNet, rdStart, rd } = this.prog;
    const moving = new Set<number>();
    for (let i = 0; i < lastLen; i++) moving.add(this.lastChanged[i]!);
    let waveLen = curLen;
    for (let k = 0; k < 64 && waveLen; k++) {
      let ch = 0;
      for (let i = 0; i < waveLen; i++) {
        const p = this.cur[i]!;
        if (kind[p] !== K_GATE) continue;
        const v = gateTable[gate[p]! * 9 + this.net[in0[p]!]! * 3 + this.net[in1[p]!]!]!;
        const s = out[p]!;
        if (this.slot[s] !== v) {
          this.chS[ch] = s;
          this.chV[ch++] = v;
        }
      }
      const w = this.nextStamp();
      let nextLen = 0;
      const nxt = this.nxt;
      for (let j = 0; j < ch; j++) {
        const s = this.chS[j]!;
        this.slot[s] = this.chV[j]!;
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

    const cheap = eT + prog.freeCount * waves + prog.sumLevels;
    if (cheap > this.budget && !this.tightBound(eT, waves)) return this.fallback(start);

    this.logging = false;
    const eF = this.freePass();
    this.stats.fastSettles++;
    return { stable: true, unstableNets: [], contentionNets: this.contentionList(), events: eT + eF };
  }

  private fallback(start: ArrayLike<number>): SettleResult {
    this.stats.fallbacks++;
    this.logging = false;
    for (let i = this.undoLen - 1; i >= 0; i--) {
      const idx = this.undoIdx[i]!;
      const old = this.undoOld[i]!;
      switch (this.undoKind[i]) {
        case U_SLOT:
          this.slot[idx] = old;
          break;
        case U_NET:
          this.net[idx] = old;
          break;
        case U_CONT:
          this.cont[idx] = old;
          break;
        case U_STATE:
          this.dffState[idx] = old;
          break;
        default:
          this.dffPrevClk[idx] = old;
      }
    }
    this.undoLen = 0;
    this.clearFree();
    return this.settleExact(start);
  }

  /**
   * Upper bound on free-gate events in the reference, tighter than the cheap
   * one: a free gate switches at most once per wave in which it is woken, it
   * is woken by timed drivers in the waves counted in `wakeCount`, and by a
   * free driver at most as often as that driver switches.
   */
  private tightBound(eT: number, waves: number): boolean {
    const { order, level, out, slotNet, fRdStart, fRd } = this.prog;
    const acc = this.acc;
    acc.fill(0);
    let total = eT;
    for (let i = 0; i < order.length; i++) {
      const p = order[i]!;
      let b = acc[p]! + (this.wakeGen[p] === this.wakeEpoch ? this.wakeCount[p]! : 0);
      const cap = waves + level[p]!;
      if (b > cap) b = cap;
      if (b === 0) continue;
      total += b;
      if (total > this.budget) return false;
      const n = slotNet[out[p]!]!;
      for (let k = fRdStart[n]!; k < fRdStart[n + 1]!; k++) {
        const r = fRd[k]!;
        const v = acc[r]! + b;
        acc[r] = v > SAT ? SAT : v;
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

  /** Evaluate dirty free gates once each, in level order. Returns events. */
  private freePass(): number {
    const { gate, gateTable, in0, in1, out, slotNet, levelStart, fRdStart, fRd } = this.prog;
    const net = this.net;
    const slot = this.slot;
    let events = 0;
    for (let L = this.minDirty; L <= this.maxDirty; L++) {
      const base = levelStart[L - 1]!;
      const fill = this.bucketFill[L]!;
      for (let i = 0; i < fill; i++) {
        const p = this.bucket[base + i]!;
        this.fDirty[p] = 0;
        const v = gateTable[gate[p]! * 9 + net[in0[p]!]! * 3 + net[in1[p]!]!]!;
        const s = out[p]!;
        if (slot[s] === v) continue;
        slot[s] = v;
        events++;
        const n = slotNet[s]!;
        if (!this.refresh(n)) continue;
        for (let k = fRdStart[n]!; k < fRdStart[n + 1]!; k++) this.markFree(fRd[k]!);
      }
      this.bucketFill[L] = 0;
    }
    this.minDirty = this.prog.maxLevel + 1;
    this.maxDirty = 0;
    return events;
  }

  /** Free gates equal their function and flip-flops have seen their clock. */
  private checkConsistent(): boolean {
    const { kind, region, gate, gateTable, in0, in1, out } = this.prog;
    for (let p = 0; p < this.prog.partCount; p++) {
      if (region[p] === R_FREE) {
        const v = gateTable[gate[p]! * 9 + this.net[in0[p]!]! * 3 + this.net[in1[p]!]!]!;
        if (this.slot[out[p]!] !== v) return false;
      } else if (kind[p] === K_DFF) {
        if (this.dffPrevClk[p] !== this.net[in1[p]!] || this.slot[out[p]!] !== this.dffState[p]) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- nets

  private log(kind: number, idx: number, old: number): void {
    if (this.undoLen === this.undoKind.length) {
      const grow = <T extends Uint8Array | Int32Array>(a: T, make: (n: number) => T): T => {
        const b = make(a.length * 2);
        b.set(a);
        return b;
      };
      this.undoKind = grow(this.undoKind, (n) => new Uint8Array(n));
      this.undoIdx = grow(this.undoIdx, (n) => new Int32Array(n));
      this.undoOld = grow(this.undoOld, (n) => new Uint8Array(n));
    }
    this.undoKind[this.undoLen] = kind;
    this.undoIdx[this.undoLen] = idx;
    this.undoOld[this.undoLen++] = old;
  }

  private setState(p: number, v: number): void {
    if (this.dffState[p] === v) return;
    if (this.logging) this.log(U_STATE, p, this.dffState[p]!);
    this.dffState[p] = v;
  }

  private setPrev(p: number, v: number): void {
    if (this.logging) this.log(U_PREV, p, this.dffPrevClk[p]!);
    this.dffPrevClk[p] = v;
  }

  /** Recompute a net from its drivers; returns true when its value changed. */
  private refresh(n: number): boolean {
    const v = this.resolve(n);
    if (this.net[n] === v) return false;
    if (this.logging) this.log(U_NET, n, this.net[n]!);
    this.net[n] = v;
    return true;
  }

  /** Same resolution rule (and driver order) as the reference. */
  private resolve(n: number): number {
    const { drvStart, drv } = this.prog;
    const a = drvStart[n]!;
    const b = drvStart[n + 1]!;
    if (a === b) return VX;
    let v = this.slot[drv[a]!]!;
    if (b - a === 1) return v;
    let clash = 0;
    for (let k = a + 1; k < b; k++) {
      const d = this.slot[drv[k]!]!;
      if (d !== v) {
        if (d !== VX && v !== VX) clash = 1;
        v = VX;
      }
    }
    if (this.cont[n] !== clash) {
      if (this.logging) this.log(U_CONT, n, this.cont[n]!);
      this.cont[n] = clash;
    }
    return v;
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
    if (k === K_SWITCH) v = this.switchOn[i] ? V1 : V0;
    else if (k === K_CLOCK) v = this.clockLevel;
    else if (k === K_DFF) v = this.dffState[i]!;
    else return EMPTY;
    const s = prog.out[i]!;
    this.slot[s] = v;
    const n = prog.slotNet[s]!;
    return this.refresh(n) ? prog.rd.subarray(prog.rdStart[n]!, prog.rdStart[n + 1]!) : EMPTY;
  }
}

const EMPTY = new Int32Array(0);

function idle(): SettleResult {
  return { stable: true, unstableNets: [], contentionNets: [], events: 0 };
}
