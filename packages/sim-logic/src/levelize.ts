import type { Netlist } from './compile';
import { mask } from './values';

/**
 * SIM-03: the second compile stage. Turns a `Netlist` into flat typed arrays
 * for the fast engine and splits the parts into two regions:
 *
 * - TIMED parts are simulated wave by wave with unit delay, exactly like the
 *   reference engine, because the exact moment their outputs change can be
 *   observed: combinational parts on combinational loops, flip-flops whose
 *   clock comes from logic ("dirty" clocks), every clocked block, every
 *   combinational part in the fan-in cone of those, and every flip-flop.
 * - FREE parts are the remaining combinational parts (gates, buffers,
 *   tri-states, splitters, joiners, combinational blocks). Nothing
 *   timing-sensitive reads them (they only feed lamps, other free parts, and
 *   the D pin of flip-flops with a clean clock, which sample D before any
 *   part has switched), so after a settle only their final values matter.
 *   They are levelized and evaluated once per settle in level order.
 *
 * A flip-flop has a CLEAN clock when every driver of its clock net is a
 * switch, button, const or the global clock. Such a flip-flop can only
 * capture in the first wave of a settle, using the D value from before the
 * settle, so glitches on its D cone are invisible and the cone does not need
 * timing. Clocked blocks are always seeds of the timed region: their outputs
 * may depend on their inputs combinationally (RAM read), so their whole
 * fan-in cone is timed.
 */

export const K_GATE = 0;
export const K_SOURCE = 1;
export const K_CLOCK = 2;
export const K_LAMP = 3;
export const K_DFF = 4;
export const K_BUF = 5;
export const K_TRI = 6;
export const K_SPLIT = 7;
export const K_JOIN = 8;
export const K_BLOCK = 9;
/** A clocked block. */
export const K_CBLOCK = 10;
/** Legacy alias. */
export const K_SWITCH = K_SOURCE;

export const R_NONE = 0;
export const R_TIMED = 1;
export const R_FREE = 2;

/** Combinational kinds: K_GATE and K_BUF..K_BLOCK. */
export const isComb = (k: number): boolean => k === K_GATE || (k >= K_BUF && k <= K_BLOCK);

export interface FastProgram {
  partCount: number;
  netCount: number;
  slotCount: number;
  /** K_* per part. */
  kind: Uint8Array;
  /** Gate op (G_*) for gates. */
  op: Uint8Array;
  /** First two input nets per part (-1 when the pin does not exist). One-input gates read in0 twice. */
  in0: Int32Array;
  in1: Int32Array;
  /** CSR: part -> input nets. */
  inStart: Int32Array;
  inNet: Int32Array;
  /** First output slot per part (-1 when none); a part's slots are out[p] .. out[p] + nOut[p] - 1. */
  out: Int32Array;
  nOut: Int32Array;
  /** Splitter/joiner chunk size. */
  chunk: Int32Array;
  /** Index of the 'clk' input for clocked parts (dff: 1). */
  clkIn: Int32Array;
  slotNet: Int32Array;
  slotMask: Uint32Array;
  netMask: Uint32Array;
  /** CSR: net -> driver slots, in netlist order. */
  drvStart: Int32Array;
  drv: Int32Array;
  /** CSR: net -> every reading part, in netlist order (lamps included). */
  rdStart: Int32Array;
  rd: Int32Array;
  /** CSR: net -> timed readers only. */
  tRdStart: Int32Array;
  tRd: Int32Array;
  /** CSR: net -> free readers only. */
  fRdStart: Int32Array;
  fRd: Int32Array;
  /** Nets with two or more drivers, ascending: the only ones that can be in contention. */
  multiNets: Int32Array;
  /** Compiler's `inLoop` flag (Tarjan over all parts); used for power-on loop resolution. */
  inLoop: Uint8Array;
  /** 1 for combinational parts on a purely combinational loop. */
  comboLoop: Uint8Array;
  /** 1 for flip-flops and clocked blocks whose clock net is driven only by sources or clocks. */
  cleanClock: Uint8Array;
  /** R_* per part. */
  region: Uint8Array;
  /** Free-region level (1 = reads no free part); 0 for every other part. */
  level: Int32Array;
  /** Free parts sorted by level; level L occupies order[levelStart[L - 1] .. levelStart[L]). */
  order: Int32Array;
  levelStart: Int32Array;
  maxLevel: number;
  freeCount: number;
  /** Output slots of free parts, and the sum of level * outputs over free parts (event bound). */
  freeSlots: number;
  sumLevelSlots: number;
  timedCount: number;
  /** Number of clocked blocks. */
  cblockCount: number;
}

export function csr(lists: readonly (readonly number[])[]): [Int32Array, Int32Array] {
  const start = new Int32Array(lists.length + 1);
  let total = 0;
  for (let i = 0; i < lists.length; i++) {
    start[i] = total;
    total += lists[i]!.length;
  }
  start[lists.length] = total;
  const flat = new Int32Array(total);
  let k = 0;
  for (const l of lists) for (const v of l) flat[k++] = v;
  return [start, flat];
}

const KIND: Record<string, number> = {
  gate: K_GATE,
  switch: K_SOURCE,
  button: K_SOURCE,
  const: K_SOURCE,
  clock: K_CLOCK,
  lamp: K_LAMP,
  dff: K_DFF,
  buffer: K_BUF,
  tristate: K_TRI,
  splitter: K_SPLIT,
  joiner: K_JOIN,
};

export function levelize(nl: Netlist): FastProgram {
  const P = nl.parts.length;
  const N = nl.netCount;
  const S = nl.slotNet.length;
  const kind = new Uint8Array(P);
  const op = new Uint8Array(P);
  const in0 = new Int32Array(P).fill(-1);
  const in1 = new Int32Array(P).fill(-1);
  const out = new Int32Array(P).fill(-1);
  const nOut = new Int32Array(P);
  const chunk = new Int32Array(P);
  const clkIn = new Int32Array(P).fill(-1);
  const inLoop = new Uint8Array(P);
  let cblockCount = 0;

  nl.parts.forEach((p, i) => {
    const k = p.kind === 'block' ? (p.clocked ? K_CBLOCK : K_BLOCK) : KIND[p.kind]!;
    kind[i] = k;
    if (k === K_CBLOCK) cblockCount++;
    if (p.op >= 0) op[i] = p.op;
    if (p.inputNets.length > 0) in0[i] = p.inputNets[0]!;
    // A one-input gate reads its only net twice so evaluation stays branch-free.
    if (p.inputNets.length > 1) in1[i] = p.inputNets[1]!;
    else if (k === K_GATE) in1[i] = p.inputNets[0]!;
    if (p.outputSlots.length > 0) out[i] = p.outputSlots[0]!;
    nOut[i] = p.outputSlots.length;
    chunk[i] = k === K_SPLIT ? (p.outputWidths[0] ?? 1) : k === K_JOIN ? (p.inputWidths[0] ?? 1) : 0;
    clkIn[i] = p.clocked ? p.clkInput : -1;
    inLoop[i] = p.inLoop ? 1 : 0;
  });
  const [inStart, inNet] = csr(nl.parts.map((p) => p.inputNets));

  const [drvStart, drv] = csr(nl.netDrivers);
  const [rdStart, rd] = csr(nl.netReaders);
  const slotPart = nl.slotPart;
  const multi: number[] = [];
  for (let n = 0; n < N; n++) if (drvStart[n + 1]! - drvStart[n]! > 1) multi.push(n);

  const comboLoop = markComboLoops(P, kind, out, nOut, nl.slotNet, rdStart, rd);

  // Clean clocks: every driver of the clock net is a source or the clock.
  const cleanClock = new Uint8Array(P);
  for (let p = 0; p < P; p++) {
    if (kind[p] !== K_DFF && kind[p] !== K_CBLOCK) continue;
    const clk = inNet[inStart[p]! + clkIn[p]!]!;
    let clean = 1;
    for (let k = drvStart[clk]!; k < drvStart[clk + 1]!; k++) {
      const q = kind[slotPart[drv[k]!]!]!;
      if (q !== K_SOURCE && q !== K_CLOCK) clean = 0;
    }
    cleanClock[p] = clean;
  }

  // Timed region: backward closure from loop parts, dirty-clock flip-flops
  // and clocked blocks. The walk does not continue through clean-clock
  // flip-flops: their output timing does not depend on their inputs.
  const region = new Uint8Array(P);
  const queue: number[] = [];
  for (let p = 0; p < P; p++) {
    const k = kind[p]!;
    if (k === K_DFF || k === K_CBLOCK) region[p] = R_TIMED;
    if ((isComb(k) && comboLoop[p]) || (k === K_DFF && !cleanClock[p]) || k === K_CBLOCK) {
      region[p] = R_TIMED;
      queue.push(p);
    }
  }
  while (queue.length) {
    const p = queue.pop()!;
    for (let j = inStart[p]!; j < inStart[p + 1]!; j++) {
      const n = inNet[j]!;
      for (let k = drvStart[n]!; k < drvStart[n + 1]!; k++) {
        const q = slotPart[drv[k]!]!;
        if (isComb(kind[q]!) && region[q] !== R_TIMED) {
          region[q] = R_TIMED;
          queue.push(q);
        }
      }
    }
  }
  let timedCount = 0;
  for (let p = 0; p < P; p++) {
    if (isComb(kind[p]!) && region[p] !== R_TIMED) region[p] = R_FREE;
    if (region[p] === R_TIMED) timedCount++;
  }

  // Levelize the free region (it is acyclic: free parts are never on a combinational loop).
  const level = new Int32Array(P);
  const indeg = new Int32Array(P);
  const freeSucc = (p: number, f: (r: number) => void): void => {
    for (let s = out[p]!; s < out[p]! + nOut[p]!; s++) {
      const n = nl.slotNet[s]!;
      for (let k = rdStart[n]!; k < rdStart[n + 1]!; k++) {
        const r = rd[k]!;
        if (region[r] === R_FREE) f(r);
      }
    }
  };
  let freeCount = 0;
  let freeSlots = 0;
  for (let p = 0; p < P; p++) {
    if (region[p] !== R_FREE) continue;
    freeCount++;
    freeSlots += nOut[p]!;
    freeSucc(p, (r) => indeg[r]!++);
  }
  const topo: number[] = [];
  for (let p = 0; p < P; p++) if (region[p] === R_FREE && indeg[p] === 0) topo.push(p);
  for (let i = 0; i < topo.length; i++) {
    const p = topo[i]!;
    if (level[p] === 0) level[p] = 1;
    freeSucc(p, (r) => {
      if (level[r]! < level[p]! + 1) level[r] = level[p]! + 1;
      if (--indeg[r]! === 0) topo.push(r);
    });
  }
  if (topo.length !== freeCount) throw new Error('levelize: free region is not acyclic');
  let maxLevel = 0;
  let sumLevelSlots = 0;
  for (const p of topo) {
    if (level[p]! > maxLevel) maxLevel = level[p]!;
    sumLevelSlots += level[p]! * nOut[p]!;
  }
  const levelStart = new Int32Array(maxLevel + 1);
  for (const p of topo) levelStart[level[p]!]!++;
  for (let L = 1; L <= maxLevel; L++) levelStart[L]! += levelStart[L - 1]!;
  const order = new Int32Array(freeCount);
  const fill = levelStart.slice();
  for (let p = 0; p < P; p++) if (region[p] === R_FREE) order[fill[level[p]! - 1]!++] = p;

  const tLists: number[][] = [];
  const fLists: number[][] = [];
  for (let n = 0; n < N; n++) {
    const t: number[] = [];
    const f: number[] = [];
    for (let k = rdStart[n]!; k < rdStart[n + 1]!; k++) {
      const r = rd[k]!;
      if (region[r] === R_TIMED) t.push(r);
      else if (region[r] === R_FREE) f.push(r);
    }
    tLists.push(t);
    fLists.push(f);
  }
  const [tRdStart, tRd] = csr(tLists);
  const [fRdStart, fRd] = csr(fLists);

  return {
    partCount: P,
    netCount: N,
    slotCount: S,
    kind,
    op,
    in0,
    in1,
    inStart,
    inNet,
    out,
    nOut,
    chunk,
    clkIn,
    slotNet: nl.slotNet,
    slotMask: Uint32Array.from(nl.slotWidth, (w) => mask(w)),
    netMask: Uint32Array.from(nl.netWidth, (w) => mask(w)),
    drvStart,
    drv,
    rdStart,
    rd,
    tRdStart,
    tRd,
    fRdStart,
    fRd,
    multiNets: Int32Array.from(multi),
    inLoop,
    comboLoop,
    cleanClock,
    region,
    level,
    order,
    levelStart,
    maxLevel,
    freeCount,
    freeSlots,
    sumLevelSlots,
    timedCount,
    cblockCount,
  };
}

/** Iterative Tarjan SCC over combinational parts only; flags parts on combinational loops. */
function markComboLoops(
  P: number,
  kind: Uint8Array,
  out: Int32Array,
  nOut: Int32Array,
  slotNet: Int32Array,
  rdStart: Int32Array,
  rd: Int32Array,
): Uint8Array {
  const flag = new Uint8Array(P);
  const succ = (p: number): number[] => {
    const res: number[] = [];
    for (let s = out[p]!; s < out[p]! + nOut[p]!; s++) {
      const n = slotNet[s]!;
      for (let k = rdStart[n]!; k < rdStart[n + 1]!; k++) if (isComb(kind[rd[k]!]!)) res.push(rd[k]!);
    }
    return res;
  };
  const index = new Int32Array(P).fill(-1);
  const low = new Int32Array(P);
  const onStack = new Uint8Array(P);
  const stack: number[] = [];
  let counter = 0;
  for (let root = 0; root < P; root++) {
    if (!isComb(kind[root]!) || index[root] !== -1) continue;
    const work: { v: number; edges: number[]; i: number }[] = [{ v: root, edges: succ(root), i: 0 }];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;
    while (work.length) {
      const frame = work[work.length - 1]!;
      if (frame.i < frame.edges.length) {
        const w = frame.edges[frame.i++]!;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push({ v: w, edges: succ(w), i: 0 });
        } else if (onStack[w]) {
          low[frame.v] = Math.min(low[frame.v]!, index[w]!);
        }
        continue;
      }
      work.pop();
      const v = frame.v;
      if (work.length) {
        const up = work[work.length - 1]!.v;
        low[up] = Math.min(low[up]!, low[v]!);
      }
      if (low[v] === index[v]) {
        const comp: number[] = [];
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          comp.push(w);
        } while (w !== v);
        if (comp.length > 1 || frame.edges.includes(v)) for (const c of comp) flag[c] = 1;
      }
    }
  }
  return flag;
}
