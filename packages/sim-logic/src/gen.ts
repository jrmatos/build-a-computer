/**
 * Random circuits and stimulus for differential tests (fast engine vs
 * reference). Built from fast-check arbitraries so failures shrink; every
 * run uses a fixed seed, so the suite is deterministic.
 */
import fc from 'fast-check';
import type { Board, Part, PartType, Wire } from '@ground-up/schema';
import { compile, type Netlist } from './compile';
import { ReferenceEngine, type EngineOptions, type SettleResult } from './engine';
import { FastEngine } from './fast-engine';
import { LIBRARY } from './library';

/** A wire from part `from`'s output to input `pin` of part `to`; pin -1 joins the two outputs. */
export type WireSpec = [from: number, to: number, pin: number];

export interface CircuitSpec {
  types: PartType[];
  wires: WireSpec[];
}

export type Step = { op: 'toggle'; sw: number } | { op: 'tick' } | { op: 'off' } | { op: 'on' };

export interface Scenario {
  spec: CircuitSpec;
  steps: Step[];
  opts: EngineOptions;
}

export function specToBoard(spec: CircuitSpec): Board {
  const parts: Part[] = spec.types.map((type, i) => ({ id: `p${i}`, type, x: 0, y: 0, rot: 0, flip: false }));
  const wires: Wire[] = spec.wires.map(([from, to, pin], i) => {
    const lib = LIBRARY[spec.types[to]!]!;
    const target = pin < 0 ? lib.outputs[0]! : lib.inputs[pin]!;
    const source = LIBRARY[spec.types[from]!]!.outputs[0]!;
    return { id: `w${i}`, from: { part: `p${from}`, pin: source }, to: { part: `p${to}`, pin: target }, points: [] };
  });
  return { parts, wires };
}

const hasOutput = (t: PartType): boolean => LIBRARY[t]!.outputs.length > 0;

const gateType = fc.constantFrom<PartType>('nand', 'not', 'and', 'or', 'nor', 'xor', 'xnor');

const loopBodyType: fc.Arbitrary<PartType> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<PartType>('nand') },
  { weight: 6, arbitrary: gateType },
  { weight: 2, arbitrary: fc.constant<PartType>('dff') },
  { weight: 1, arbitrary: fc.constant<PartType>('clock') },
  { weight: 1, arbitrary: fc.constant<PartType>('lamp') },
  { weight: 1, arbitrary: fc.constant<PartType>('switch') },
);

/** Pick a driver for an input pin: about 1 in 12 choices leaves it floating. */
function pickDriver(choice: number, drivers: number[]): number {
  if (drivers.length === 0 || choice % 12 === 0) return -1;
  return drivers[choice % drivers.length]!;
}

function inputPins(types: PartType[]): [number, number][] {
  const pins: [number, number][] = [];
  types.forEach((t, i) => LIBRARY[t]!.inputs.forEach((_, k) => pins.push([i, k])));
  return pins;
}

/** Circuits with any wiring at all: combinational loops, latches, rings, counters, gated clocks. */
export function loopCircuit(maxBody = 14): fc.Arbitrary<CircuitSpec> {
  return fc
    .tuple(fc.integer({ min: 1, max: 3 }), fc.array(loopBodyType, { minLength: 2, maxLength: maxBody, size: 'max' }))
    .chain(([nSw, body]) => {
      const types: PartType[] = [...Array<PartType>(nSw).fill('switch'), ...body];
      const pins = inputPins(types);
      const outs = types.flatMap((t, i) => (hasOutput(t) ? [i] : []));
      return fc
        .tuple(
          fc.array(fc.nat(), { minLength: pins.length, maxLength: pins.length }),
          fc.array(fc.tuple(fc.nat(), fc.nat(), fc.boolean()), { maxLength: 2 }),
        )
        .map(([choices, extra]) => {
          const wires: WireSpec[] = [];
          pins.forEach(([part, pin], k) => {
            const d = pickDriver(choices[k]!, outs);
            if (d >= 0) wires.push([d, part, pin]);
          });
          // Extra wires: a second driver on an input (contention) or two outputs joined.
          for (const [a, b, joinOutputs] of extra) {
            if (outs.length === 0) break;
            const from = outs[a % outs.length]!;
            if (joinOutputs) wires.push([from, outs[b % outs.length]!, -1]);
            else if (pins.length) {
              const [part, pin] = pins[b % pins.length]!;
              wires.push([from, part, pin]);
            }
          }
          return { types, wires };
        });
    });
}

/** Acyclic circuits: switches, then gates that only read earlier parts, then lamps. */
export function acyclicCircuit(maxGates = 24): fc.Arbitrary<CircuitSpec> {
  return fc
    .tuple(fc.integer({ min: 1, max: 5 }), fc.array(gateType, { minLength: 1, maxLength: maxGates, size: 'max' }), fc.integer({ min: 0, max: 3 }))
    .chain(([nSw, gates, nLamps]) => {
      const types: PartType[] = [...Array<PartType>(nSw).fill('switch'), ...gates, ...Array<PartType>(nLamps).fill('lamp')];
      const pins = inputPins(types);
      return fc
        .tuple(
          fc.array(fc.nat(), { minLength: pins.length, maxLength: pins.length }),
          fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 1 }),
        )
        .map(([choices, extra]) => {
          const wires: WireSpec[] = [];
          pins.forEach(([part, pin], k) => {
            const earlier: number[] = [];
            for (let j = 0; j < part; j++) if (hasOutput(types[j]!)) earlier.push(j);
            const d = pickDriver(choices[k]!, earlier);
            if (d >= 0) wires.push([d, part, pin]);
          });
          // Rarely, a second driver on a lamp: contention without a loop.
          const lamps = types.flatMap((t, i) => (t === 'lamp' ? [i] : []));
          for (const [a, b] of extra) {
            if (!lamps.length) break;
            const lamp = lamps[b % lamps.length]!;
            const outs = types.flatMap((t, i) => (hasOutput(t) ? [i] : []));
            wires.push([outs[a % outs.length]!, lamp, 0]);
          }
          return { types, wires };
        })
        .filter((spec) => compile(specToBoard(spec)).parts.every((p) => !p.inLoop));
    });
}

const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 8, arbitrary: fc.nat().map((sw): Step => ({ op: 'toggle', sw })) },
  { weight: 5, arbitrary: fc.constant<Step>({ op: 'tick' }) },
  { weight: 1, arbitrary: fc.constant<Step>({ op: 'off' }) },
  { weight: 1, arbitrary: fc.constant<Step>({ op: 'on' }) },
);

const options: fc.Arbitrary<EngineOptions> = fc.record({
  seed: fc.nat(),
  powerOnState: fc.constantFrom<'zero' | 'random'>('zero', 'random'),
  eventBudgetPerPart: fc.oneof(
    { weight: 1, arbitrary: fc.constant(1000) },
    { weight: 4, arbitrary: fc.constant(40) },
    { weight: 2, arbitrary: fc.constant(6) },
    { weight: 1, arbitrary: fc.constant(2) },
    { weight: 2, arbitrary: fc.constant(1) },
  ),
});

export function scenario(circuit: fc.Arbitrary<CircuitSpec>, maxSteps = 24): fc.Arbitrary<Scenario> {
  return fc.record({ spec: circuit, steps: fc.array(step, { minLength: 4, maxLength: maxSteps, size: 'max' }), opts: options });
}

// ------------------------------------------------------------------ runner

export interface DiffStats {
  steps: number;
  settles: number;
  fastSettles: number;
  exactSettles: number;
  fallbacks: number;
  unstable: number;
  contention: number;
  timedParts: number;
  freeParts: number;
}

export const emptyStats = (): DiffStats => ({
  steps: 0,
  settles: 0,
  fastSettles: 0,
  exactSettles: 0,
  fallbacks: 0,
  unstable: 0,
  contention: 0,
  timedParts: 0,
  freeParts: 0,
});

interface RefInternals {
  slot: Uint8Array;
  dffState: Uint8Array;
  dffPrevClk: Uint8Array;
}

const sorted = (a: readonly number[]): number[] => [...a].sort((x, y) => x - y);
const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * Drive both engines through the scenario and compare every observable after
 * every step. Throws with a description on the first difference.
 */
export function runDiff(sc: Scenario, stats: DiffStats = emptyStats(), nl: Netlist = compile(specToBoard(sc.spec))): DiffStats {
  if (nl.diagnostics.some((d) => d.code === 'bad-wire')) throw new Error('generator produced a bad wire');
  const ref = new ReferenceEngine(nl, sc.opts);
  const fast = new FastEngine(nl, sc.opts);
  stats.timedParts += fast.prog.timedCount;
  stats.freeParts += fast.prog.freeCount;
  const switches = nl.parts.filter((p) => p.behavior.kind === 'switch').map((p) => p.id);

  const check = (what: string, r: SettleResult | undefined, f: SettleResult | undefined, fastBefore: number): void => {
    const fail = (msg: string): never => {
      throw new Error(`step ${stats.steps} (${what}): ${msg}`);
    };
    if (r && f) {
      stats.settles++;
      if (!r.stable) stats.unstable++;
      if (r.contentionNets.length) stats.contention++;
      if (r.stable !== f.stable) fail(`stable ${r.stable} vs ${f.stable}`);
      if (!same(r.unstableNets, f.unstableNets)) fail(`unstable ${r.unstableNets} vs ${f.unstableNets}`);
      if (!same(sorted(r.contentionNets), f.contentionNets)) fail(`contention ${r.contentionNets} vs ${f.contentionNets}`);
      const exactOnly = fast.stats.fastSettles === fastBefore;
      if (exactOnly ? f.events !== r.events : f.events > r.events) fail(`events ${r.events} vs ${f.events}`);
    }
    if (!same(ref.net, fast.net)) fail(`nets ${[...ref.net]} vs ${[...fast.net]}`);
    const ri = ref as unknown as RefInternals;
    const fi = fast.internalState();
    if (!same(ri.slot, fi.slot)) fail(`slots ${[...ri.slot]} vs ${[...fi.slot]}`);
    if (!same(ri.dffState, fi.dffState)) fail(`dff state ${[...ri.dffState]} vs ${[...fi.dffState]}`);
    if (!same(ri.dffPrevClk, fi.dffPrevClk)) fail(`dff clk ${[...ri.dffPrevClk]} vs ${[...fi.dffPrevClk]}`);
    if (ref.ticks !== fast.ticks || ref.clock !== fast.clock || ref.isPowered !== fast.isPowered) fail('clock/power');
    for (const id of switches) if (ref.isSwitchOn(id) !== fast.isSwitchOn(id)) fail(`switch ${id}`);
    for (const p of nl.parts) {
      for (const pin of [...LIBRARY[p.type]!.inputs, ...LIBRARY[p.type]!.outputs]) {
        if (ref.readPin(p.id, pin) !== fast.readPin(p.id, pin)) fail(`pin ${p.id}.${pin}`);
      }
    }
  };

  let before = fast.stats.fastSettles;
  check('powerOn', ref.powerOn(), fast.powerOn(), before);
  for (const s of sc.steps) {
    stats.steps++;
    before = fast.stats.fastSettles;
    if (s.op === 'toggle') {
      if (!switches.length) continue;
      const id = switches[s.sw % switches.length]!;
      const on = !ref.isSwitchOn(id);
      check(`toggle ${id}`, ref.setSwitch(id, on), fast.setSwitch(id, on), before);
    } else if (s.op === 'tick') {
      check('tick', ref.tick(), fast.tick(), before);
    } else if (s.op === 'off') {
      ref.powerOff();
      fast.powerOff();
      check('powerOff', undefined, undefined, before);
    } else {
      check('powerOn', ref.powerOn(), fast.powerOn(), before);
    }
  }
  stats.fastSettles += fast.stats.fastSettles;
  stats.exactSettles += fast.stats.exactSettles;
  stats.fallbacks += fast.stats.fallbacks;
  return stats;
}
