import { Prng } from '@build-a-computer/det';
import type { Board, ChipDef, ChipMap, Part, PartType, Wire } from '@build-a-computer/schema';
import { compile } from './compile';
import { ReferenceEngine, type SettleResult } from './engine';
import { ChipCycleError, flattenBoard, modelPartFor } from './flatten';
import { PART_INFO, pinsOf, type PinSpec } from './parts-spec';
import { fromValue, mask, type Signal } from './values';

/**
 * Behavioral swap check (CHIP-04, E-SIM-09): the player's gates and the
 * canonical model are driven with the same input vectors and must agree on
 * every output. Combinational chips settle after each vector; when the input
 * space fits in `vectors` it is tested exhaustively. Sequential chips (clocked
 * model, or flip-flops inside) get their `clk` port from the global clock and
 * are compared after the inputs settle, after the rising edge and after the
 * falling edge, so outputs must change only at the clock edge like the model.
 */

export interface SwapOptions {
  /** Random vectors to try (default 10,000). */
  vectors?: number;
  /** PRNG seed for the vectors (default 1). */
  seed?: number;
}

export interface SwapVector {
  /** Input values by port name (the clock port is omitted). */
  inputs: Record<string, number>;
  /** Model outputs by port name. */
  expected: Record<string, Signal>;
  /** The player's gates' outputs by port name. */
  actual: Record<string, Signal>;
  /** Sequential chips: vector index since power on, and when the outputs were compared. */
  cycle?: number;
  phase?: 'settle' | 'rise' | 'fall';
  /** Sequential chips: inputs applied in earlier cycles, oldest first. */
  history?: Record<string, number>[];
}

export type SwapResult =
  | { ok: true; vectors: number; exhaustive: boolean; sequential: boolean }
  | {
      ok: false;
      reason: 'mismatch' | 'unstable' | 'ports' | 'unsupported' | 'cycle';
      message: string;
      vector?: SwapVector;
    };

/** Engine surface used here: today's 1-bit API, plus the multi-bit API when present. */
interface DrivableEngine {
  powerOn(): SettleResult;
  tick(): SettleResult;
  setSwitch(partId: string, on: boolean): SettleResult;
  readPin(partId: string, pin: string): number;
  setValue?(partId: string, value: number): SettleResult;
  readSignal?(partId: string, pin: string): Signal;
}

const engineSupportsBuses = (e: DrivableEngine): boolean =>
  typeof e.setValue === 'function' && typeof e.readSignal === 'function';

function drive(e: DrivableEngine, id: string, width: number, value: number): SettleResult {
  if (typeof e.setValue === 'function') return e.setValue(id, value);
  if (width !== 1) throw new Error('multi-bit inputs need the bus engine');
  return e.setSwitch(id, value === 1);
}

function read(e: DrivableEngine, id: string, pin: string, width: number): Signal {
  if (typeof e.readSignal === 'function') return e.readSignal(id, pin);
  if (width !== 1) throw new Error('multi-bit outputs need the bus engine');
  return fromValue(e.readPin(id, pin));
}

const part = (id: string, type: PartType, width: number): Part => ({
  id,
  type,
  x: 0,
  y: 0,
  rot: 0,
  flip: false,
  ...(width !== 1 ? { props: { width } } : {}),
});

const wire = (id: string, fp: string, fpin: string, tp: string, tpin: string): Wire => ({
  id,
  from: { part: fp, pin: fpin },
  to: { part: tp, pin: tpin },
  points: [],
});

/** Switches (or the clock) -> chip instance 'dut' -> lamps. */
function harness(def: ChipDef, ins: PinSpec[], outs: PinSpec[], clkIndex: number): Board {
  const parts: Part[] = [];
  const wires: Wire[] = [];
  ins.forEach((p, i) => {
    parts.push(part(`in${i}`, i === clkIndex ? 'clock' : 'switch', i === clkIndex ? 1 : p.width));
    wires.push(wire(`wi${i}`, `in${i}`, 'out', 'dut', p.name));
  });
  parts.push({ ...part('dut', 'chip', 1), chip: def.id });
  outs.forEach((p, j) => {
    parts.push(part(`out${j}`, 'lamp', p.width));
    wires.push(wire(`wo${j}`, 'dut', p.name, `out${j}`, 'in'));
  });
  return { parts, wires };
}

/** Bits where both are known must match, and the player's must not be X where the model's is known. */
const agrees = (expected: Signal, actual: Signal): boolean => {
  const known = ~expected.x & mask(expected.w);
  return ((actual.x & known) | ((actual.v ^ expected.v) & known)) >>> 0 === 0;
};

export function checkEquivalence(def: ChipDef, chips: ChipMap, modelType: PartType, opts: SwapOptions = {}): SwapResult {
  const budget = Math.max(1, opts.vectors ?? 10_000);
  const m = modelPartFor(def, modelType, chips);
  if ('error' in m) return { ok: false, reason: 'ports', message: m.error };

  const gatesDef: ChipDef = { ...def, simulateGates: true };
  delete gatesDef.model;
  const modelDef: ChipDef = { ...def, model: modelType, simulateGates: false };
  const pins = pinsOf({ ...part('dut', 'chip', 1), chip: def.id }, { ...chips, [def.id]: def });
  const ins = pins.filter((p) => p.dir === 'in');
  const outs = pins.filter((p) => p.dir === 'out');
  const modelIns = pinsOf(m.part).filter((p) => p.dir === 'in');

  let gatesFlat: Board;
  let modelFlat: Board;
  try {
    const g = flattenBoard(harness(gatesDef, ins, outs, -1), { ...chips, [def.id]: gatesDef });
    const sequential = PART_INFO[modelType].clocked || g.board.parts.some((p) => PART_INFO[p.type].clocked);
    const clkIndex = sequential ? modelIns.findIndex((p) => p.name === 'clk') : -1;
    if (sequential && clkIndex < 0) {
      return { ok: false, reason: 'ports', message: 'A sequential chip needs a clk input where the model has one.' };
    }
    gatesFlat = sequential ? flattenBoard(harness(gatesDef, ins, outs, clkIndex), { ...chips, [def.id]: gatesDef }).board : g.board;
    modelFlat = flattenBoard(harness(modelDef, ins, outs, clkIndex), { ...chips, [def.id]: modelDef }).board;
    return run(gatesFlat, modelFlat, ins, outs, clkIndex, sequential, budget, opts.seed ?? 1);
  } catch (e) {
    if (e instanceof ChipCycleError) return { ok: false, reason: 'cycle', message: e.message };
    throw e;
  }
}

function run(
  gatesFlat: Board,
  modelFlat: Board,
  ins: PinSpec[],
  outs: PinSpec[],
  clkIndex: number,
  sequential: boolean,
  budget: number,
  seed: number,
): SwapResult {
  const opts = { powerOnState: 'zero' as const, seed };
  const modelNl = compile(modelFlat);
  // The engine drops or flags part types it cannot run yet.
  const unsupported = modelNl.diagnostics.some((d) => (d.code as string) === 'unsupported-part');
  if (unsupported || !modelNl.partIndex.has('dut')) {
    return { ok: false, reason: 'unsupported', message: `The engine has no behavioral model for ${modelFlat.parts.find((p) => p.id === 'dut')?.type ?? 'this block'} yet.` };
  }
  const actualE = new ReferenceEngine(compile(gatesFlat), opts) as unknown as DrivableEngine;
  const expectE = new ReferenceEngine(modelNl, opts) as unknown as DrivableEngine;
  const data = ins.map((p, i) => ({ p, i })).filter(({ i }) => i !== clkIndex);
  const bits = data.reduce((s, { p }) => s + p.width, 0);
  if (!engineSupportsBuses(actualE) && [...ins, ...outs].some((p) => p.width !== 1)) {
    return { ok: false, reason: 'unsupported', message: 'Multi-bit chips need the bus engine.' };
  }

  const exhaustive = !sequential && bits <= 30 && 2 ** bits <= budget;
  const count = exhaustive ? 2 ** bits : budget;
  const prng = new Prng(seed);
  const vectorAt = (k: number): number[] => {
    if (exhaustive) {
      let rest = k;
      return data.map(({ p }) => {
        const v = rest & mask(p.width);
        rest = Math.floor(rest / 2 ** p.width);
        return v >>> 0;
      });
    }
    return data.map(({ p }) => (prng.nextU32() & mask(p.width)) >>> 0);
  };

  actualE.powerOn();
  expectE.powerOn();
  const history: Record<string, number>[] = [];
  const named = (values: number[]) => Object.fromEntries(data.map(({ p }, j) => [p.name, values[j]!]));

  const compare = (values: number[], k: number, phase: 'settle' | 'rise' | 'fall', settled: SettleResult): SwapResult | null => {
    const expected: Record<string, Signal> = {};
    const actual: Record<string, Signal> = {};
    let same = true;
    outs.forEach((p, j) => {
      const e = read(expectE, `out${j}`, 'in', p.width);
      const a = read(actualE, `out${j}`, 'in', p.width);
      expected[p.name] = e;
      actual[p.name] = a;
      if (!agrees(e, a)) same = false;
    });
    if (same && settled.stable) return null;
    const vector: SwapVector = { inputs: named(values), expected, actual };
    if (sequential) Object.assign(vector, { cycle: k, phase, history: [...history] });
    if (!settled.stable) {
      return { ok: false, reason: 'unstable', message: 'Your chip did not settle on this input.', vector };
    }
    const shown = Object.entries(vector.inputs)
      .map(([n, v]) => `${n}=${v}`)
      .join(' ');
    return { ok: false, reason: 'mismatch', message: `Your chip differs from the model at ${shown || 'power on'}.`, vector };
  };

  for (let k = 0; k < count; k++) {
    const values = vectorAt(k);
    let stable = true;
    data.forEach(({ p, i }, j) => {
      drive(expectE, `in${i}`, p.width, values[j]!);
      if (!drive(actualE, `in${i}`, p.width, values[j]!).stable) stable = false;
    });
    const settleStatus: SettleResult = { stable, unstableNets: [], contentionNets: [], events: 0 };
    const r0 = compare(values, k, 'settle', settleStatus);
    if (r0) return r0;
    if (sequential) {
      expectE.tick();
      const r1 = compare(values, k, 'rise', actualE.tick());
      if (r1) return r1;
      expectE.tick();
      const r2 = compare(values, k, 'fall', actualE.tick());
      if (r2) return r2;
      history.push(named(values));
    }
  }
  return { ok: true, vectors: count, exhaustive, sequential };
}
