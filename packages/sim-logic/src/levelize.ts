import type { Netlist } from './compile';
import { LIBRARY } from './library';
import { V0, V1, VX } from './values';

/**
 * SIM-03: the second compile stage. Turns a `Netlist` into flat typed arrays
 * for the fast engine and splits the parts into two regions:
 *
 * - TIMED parts are simulated wave by wave with unit delay, exactly like the
 *   reference engine, because the exact moment their outputs change can be
 *   observed: gates on combinational loops, flip-flops whose clock comes from
 *   logic ("dirty" clocks), every gate in the fan-in cone of those, and every
 *   flip-flop.
 * - FREE parts are the remaining gates. Nothing timing-sensitive reads them
 *   (they only feed lamps, other free gates, and the D pin of flip-flops with
 *   a clean clock, which sample D before any gate has switched), so after a
 *   settle only their final values matter. They are levelized and evaluated
 *   once per settle in level order.
 *
 * A flip-flop has a CLEAN clock when every driver of its clock net is a
 * switch or the global clock. Such a flip-flop can only capture in the first
 * wave of a settle, using the D value from before the settle, so glitches on
 * its D cone are invisible and the cone does not need timing.
 */

export const K_GATE = 0;
export const K_SWITCH = 1;
export const K_CLOCK = 2;
export const K_LAMP = 3;
export const K_DFF = 4;

export const R_NONE = 0;
export const R_TIMED = 1;
export const R_FREE = 2;

export interface FastProgram {
  partCount: number;
  netCount: number;
  slotCount: number;
  /** K_* per part. */
  kind: Uint8Array;
  /** Row in `gateTable` for gates. */
  gate: Uint8Array;
  /** Truth tables: gateTable[gate * 9 + a * 3 + b] for values 0, 1, X. */
  gateTable: Uint8Array;
  /** Input nets per part (-1 when the pin does not exist). */
  in0: Int32Array;
  in1: Int32Array;
  /** Output slot per part (-1 when none). Every library part has at most one output. */
  out: Int32Array;
  slotNet: Int32Array;
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
  /** 1 for gates on a purely combinational loop (flip-flops break loops here). */
  comboLoop: Uint8Array;
  /** 1 for flip-flops whose clock net is driven only by switches or clocks. */
  cleanClock: Uint8Array;
  /** R_* per part. */
  region: Uint8Array;
  /** Free-region level (1 = reads no free gate); 0 for every other part. */
  level: Int32Array;
  /** Free parts sorted by level; level L occupies order[levelStart[L - 1] .. levelStart[L]). */
  order: Int32Array;
  levelStart: Int32Array;
  maxLevel: number;
  freeCount: number;
  /** Sum of `level` over free parts (used for the event bound). */
  sumLevels: number;
  timedCount: number;
}

const GATE_TYPES: string[] = [];

function buildGateTable(): Uint8Array {
  const vals = [V0, V1, VX];
  const rows: number[] = [];
  for (const [type, lib] of Object.entries(LIBRARY)) {
    const b = lib.behavior;
    if (b.kind !== 'gate') continue;
    if (lib.inputs.length < 1 || lib.inputs.length > 2 || lib.outputs.length !== 1) {
      throw new Error(`Fast engine supports 1- and 2-input gates only (${type})`);
    }
    GATE_TYPES.push(type);
    for (const a of vals) {
      for (const c of vals) rows.push(lib.inputs.length === 1 ? b.eval([a]) : b.eval([a, c]));
    }
  }
  return Uint8Array.from(rows);
}

const GATE_TABLE = buildGateTable();

function csr(lists: readonly (readonly number[])[]): [Int32Array, Int32Array] {
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

export function levelize(nl: Netlist): FastProgram {
  const P = nl.parts.length;
  const N = nl.netCount;
  const S = nl.slotNet.length;
  const kind = new Uint8Array(P);
  const gate = new Uint8Array(P);
  const in0 = new Int32Array(P).fill(-1);
  const in1 = new Int32Array(P).fill(-1);
  const out = new Int32Array(P).fill(-1);
  const inLoop = new Uint8Array(P);

  nl.parts.forEach((p, i) => {
    const b = p.behavior.kind;
    kind[i] = b === 'gate' ? K_GATE : b === 'switch' ? K_SWITCH : b === 'clock' ? K_CLOCK : b === 'lamp' ? K_LAMP : K_DFF;
    if (b === 'gate') {
      const g = GATE_TYPES.indexOf(p.type);
      if (g < 0) throw new Error(`Unknown gate ${p.type}`);
      gate[i] = g;
    }
    if (p.outputSlots.length > 1) throw new Error(`Fast engine supports one output per part (${p.type})`);
    if (p.inputNets.length > 2) throw new Error(`Fast engine supports two inputs per part (${p.type})`);
    if (p.inputNets.length > 0) in0[i] = p.inputNets[0]!;
    // A one-input gate reads its only net twice so the table lookup stays branch-free.
    if (p.inputNets.length > 1) in1[i] = p.inputNets[1]!;
    else if (b === 'gate') in1[i] = p.inputNets[0]!;
    if (p.outputSlots.length === 1) out[i] = p.outputSlots[0]!;
    inLoop[i] = p.inLoop ? 1 : 0;
  });

  const [drvStart, drv] = csr(nl.netDrivers);
  const [rdStart, rd] = csr(nl.netReaders);
  const slotPart = nl.slotPart;
  const multi: number[] = [];
  for (let n = 0; n < N; n++) if (drvStart[n + 1]! - drvStart[n]! > 1) multi.push(n);

  // Gate-only successor lists: g -> gates reading g's output net.
  const outNet = (p: number): number => (out[p]! >= 0 ? nl.slotNet[out[p]!]! : -1);
  const comboLoop = markComboLoops(P, kind, outNet, rdStart, rd);

  // Clean clocks: every driver of the clock net is a switch or the clock.
  const cleanClock = new Uint8Array(P);
  for (let p = 0; p < P; p++) {
    if (kind[p] !== K_DFF) continue;
    const clk = in1[p]!;
    let clean = 1;
    for (let k = drvStart[clk]!; k < drvStart[clk + 1]!; k++) {
      const q = kind[slotPart[drv[k]!]!]!;
      if (q !== K_SWITCH && q !== K_CLOCK) clean = 0;
    }
    cleanClock[p] = clean;
  }

  // Timed region: backward closure from loop gates and dirty-clock flip-flops.
  // The walk does not continue through clean-clock flip-flops: their output
  // timing does not depend on their inputs.
  const region = new Uint8Array(P);
  const queue: number[] = [];
  for (let p = 0; p < P; p++) {
    if (kind[p] === K_DFF) region[p] = R_TIMED;
    if ((kind[p] === K_GATE && comboLoop[p]) || (kind[p] === K_DFF && !cleanClock[p])) {
      region[p] = R_TIMED;
      queue.push(p);
    }
  }
  while (queue.length) {
    const p = queue.pop()!;
    for (const n of [in0[p]!, in1[p]!]) {
      if (n < 0) continue;
      for (let k = drvStart[n]!; k < drvStart[n + 1]!; k++) {
        const q = slotPart[drv[k]!]!;
        if (kind[q] === K_GATE && region[q] !== R_TIMED) {
          region[q] = R_TIMED;
          queue.push(q);
        }
      }
    }
  }
  let timedCount = 0;
  for (let p = 0; p < P; p++) {
    if (kind[p] === K_GATE && region[p] !== R_TIMED) region[p] = R_FREE;
    if (region[p] === R_TIMED) timedCount++;
  }

  // Levelize the free region (it is acyclic: free gates are never on a combinational loop).
  const level = new Int32Array(P);
  const indeg = new Int32Array(P);
  const freeSucc = (p: number, f: (r: number) => void): void => {
    const n = outNet(p);
    if (n < 0) return;
    for (let k = rdStart[n]!; k < rdStart[n + 1]!; k++) {
      const r = rd[k]!;
      if (region[r] === R_FREE) f(r);
    }
  };
  let freeCount = 0;
  for (let p = 0; p < P; p++) {
    if (region[p] !== R_FREE) continue;
    freeCount++;
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
  let sumLevels = 0;
  for (const p of topo) {
    if (level[p]! > maxLevel) maxLevel = level[p]!;
    sumLevels += level[p]!;
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
    gate,
    gateTable: GATE_TABLE,
    in0,
    in1,
    out,
    slotNet: nl.slotNet,
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
    sumLevels,
    timedCount,
  };
}

/** Iterative Tarjan SCC over gates only; flags gates on combinational loops. */
function markComboLoops(
  P: number,
  kind: Uint8Array,
  outNet: (p: number) => number,
  rdStart: Int32Array,
  rd: Int32Array,
): Uint8Array {
  const flag = new Uint8Array(P);
  const succ = (p: number): number[] => {
    const res: number[] = [];
    const n = outNet(p);
    if (n < 0) return res;
    for (let k = rdStart[n]!; k < rdStart[n + 1]!; k++) if (kind[rd[k]!] === K_GATE) res.push(rd[k]!);
    return res;
  };
  const index = new Int32Array(P).fill(-1);
  const low = new Int32Array(P);
  const onStack = new Uint8Array(P);
  const stack: number[] = [];
  let counter = 0;
  for (let root = 0; root < P; root++) {
    if (kind[root] !== K_GATE || index[root] !== -1) continue;
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
