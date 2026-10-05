/**
 * Random circuits and stimulus for differential tests (fast engine vs
 * reference). Built from fast-check arbitraries so failures shrink; every
 * run uses a fixed seed, so the suite is deterministic.
 */
import fc from 'fast-check';
import type { Board, Part, PartProps, PartType, Wire } from '@build-a-computer/schema';
import { BLOCKS } from './blocks/index';
import { compile, type Netlist } from './compile';
import { ReferenceEngine, type EngineOptions, type SettleResult } from './engine';
import { FastEngine } from './fast-engine';
import { PART_INFO, pinsOf } from './parts-spec';

/**
 * A wire from output `fromOut` of part `from` to input `pin` of part `to`;
 * pin -1 joins the two outputs (`fromOut` of `from`, `toOut` of `to`).
 */
export type WireSpec = [from: number, to: number, pin: number, fromOut?: number, toOut?: number];

export interface CircuitSpec {
  types: PartType[];
  /** Per-part props (widths, chunks, values); missing = defaults. */
  props?: (PartProps | undefined)[];
  wires: WireSpec[];
}

export type Step =
  | { op: 'toggle'; sw: number; value?: number }
  | { op: 'tick' }
  | { op: 'off' }
  | { op: 'on' };

export interface Scenario {
  spec: CircuitSpec;
  steps: Step[];
  opts: EngineOptions;
}

const mkPart = (spec: CircuitSpec, i: number): Part => {
  const props = spec.props?.[i];
  return { id: `p${i}`, type: spec.types[i]!, x: 0, y: 0, rot: 0, flip: false, ...(props ? { props } : {}) };
};

const ins = (p: Part) => pinsOf(p).filter((s) => s.dir === 'in');
const outs = (p: Part) => pinsOf(p).filter((s) => s.dir === 'out');

export function specToBoard(spec: CircuitSpec): Board {
  const parts: Part[] = spec.types.map((_, i) => mkPart(spec, i));
  const wires: Wire[] = spec.wires.map(([from, to, pin, fromOut = 0, toOut = 0], i) => {
    const target = pin < 0 ? outs(parts[to]!)[toOut]!.name : ins(parts[to]!)[pin]!.name;
    const source = outs(parts[from]!)[fromOut]!.name;
    return { id: `w${i}`, from: { part: `p${from}`, pin: source }, to: { part: `p${to}`, pin: target }, points: [] };
  });
  return { parts, wires };
}

const hasOutput = (t: PartType): boolean => t !== 'lamp';

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
function pickDriver<T>(choice: number, drivers: T[]): T | undefined {
  if (drivers.length === 0 || choice % 12 === 0) return undefined;
  return drivers[choice % drivers.length]!;
}

function inputPins(types: PartType[]): [number, number][] {
  const pins: [number, number][] = [];
  types.forEach((t, i) => ins({ id: 'x', type: t, x: 0, y: 0, rot: 0, flip: false }).forEach((_, k) => pins.push([i, k])));
  return pins;
}

/** 1-bit circuits with any wiring at all: combinational loops, latches, rings, counters, gated clocks. */
export function loopCircuit(maxBody = 14): fc.Arbitrary<CircuitSpec> {
  return fc
    .tuple(fc.integer({ min: 1, max: 3 }), fc.array(loopBodyType, { minLength: 2, maxLength: maxBody, size: 'max' }))
    .chain(([nSw, body]) => {
      const types: PartType[] = [...Array<PartType>(nSw).fill('switch'), ...body];
      const pins = inputPins(types);
      const outIdx = types.flatMap((t, i) => (hasOutput(t) ? [i] : []));
      return fc
        .tuple(
          fc.array(fc.nat(), { minLength: pins.length, maxLength: pins.length }),
          fc.array(fc.tuple(fc.nat(), fc.nat(), fc.boolean()), { maxLength: 2 }),
        )
        .map(([choices, extra]) => {
          const wires: WireSpec[] = [];
          pins.forEach(([part, pin], k) => {
            const d = pickDriver(choices[k]!, outIdx);
            if (d !== undefined) wires.push([d, part, pin]);
          });
          // Extra wires: a second driver on an input (contention) or two outputs joined.
          for (const [a, b, joinOutputs] of extra) {
            if (outIdx.length === 0) break;
            const from = outIdx[a % outIdx.length]!;
            if (joinOutputs) wires.push([from, outIdx[b % outIdx.length]!, -1]);
            else if (pins.length) {
              const [part, pin] = pins[b % pins.length]!;
              wires.push([from, part, pin]);
            }
          }
          return { types, wires };
        });
    });
}

/** 1-bit acyclic circuits: switches, then gates that only read earlier parts, then lamps. */
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
            if (d !== undefined) wires.push([d, part, pin]);
          });
          // Rarely, a second driver on a lamp: contention without a loop.
          const lamps = types.flatMap((t, i) => (t === 'lamp' ? [i] : []));
          for (const [a, b] of extra) {
            if (!lamps.length) break;
            const lamp = lamps[b % lamps.length]!;
            const outIdx = types.flatMap((t, i) => (hasOutput(t) ? [i] : []));
            wires.push([outIdx[a % outIdx.length]!, lamp, 0]);
          }
          return { types, wires };
        })
        .filter((spec) => compile(specToBoard(spec)).parts.every((p) => !p.inLoop));
    });
}

// ------------------------------------------------------------ multi-bit

const WIDTHS = [1, 1, 2, 3, 4, 8, 32];

/** Part types for bus circuits; blocks are added when the registry has them. */
function busTypes(): PartType[] {
  const base: PartType[] = [
    'switch', 'switch', 'const', 'button', 'clock', 'lamp',
    'and', 'or', 'xor', 'nand', 'nor', 'xnor', 'not', 'buffer',
    'tristate', 'tristate', 'tristate', 'splitter', 'splitter', 'joiner', 'joiner', 'dff',
  ];
  const blocks = (Object.keys(BLOCKS) as PartType[]).filter((t) => BLOCKS[t]);
  return [...base, ...blocks];
}

const FIXED_WIDTH1 = new Set<PartType>(['button', 'clock', 'dff']);

function propsFor(type: PartType, wChoice: number, cChoice: number, value: number): PartProps | undefined {
  if (FIXED_WIDTH1.has(type)) return undefined;
  if (type === 'splitter' || type === 'joiner') {
    const w = [2, 4, 8, 6][wChoice % 4]!;
    const chunks = [1, 2, 4].filter((c) => w % c === 0 && c < w);
    return { width: w, chunk: chunks[cChoice % chunks.length]! };
  }
  if (BLOCKS[type]) {
    const d = PART_INFO[type].defaults;
    const editable = PART_INFO[type].editable;
    const props: PartProps = {};
    if (editable.includes('width')) props.width = [1, 2, 4, 8][wChoice % 4]!;
    if (d.addrWidth !== undefined) props.addrWidth = 1 + (cChoice % 3);
    if (d.selectBits !== undefined) props.selectBits = 1 + (cChoice % 3);
    if (type === 'rom') props.data = Array.from({ length: 8 }, (_, i) => ((value >>> (i * 3)) & 0xff).toString(16)).join(' ');
    return props;
  }
  const w = WIDTHS[wChoice % WIDTHS.length]!;
  if (type === 'const' || type === 'switch') return { width: w, value: value >>> 0 };
  return { width: w };
}

/**
 * Random multi-bit circuits: buses of 1..32 bits, splitters, joiners,
 * tri-state buses, consts, buttons and (when registered) blocks. Every wire
 * joins pins of the same width. `acyclic` only reads earlier parts.
 */
export function busCircuit(maxParts = 16, acyclic = false): fc.Arbitrary<CircuitSpec> {
  const types = busTypes();
  const partArb = fc.tuple(fc.nat(types.length - 1), fc.nat(), fc.nat(), fc.nat());
  return fc
    .tuple(fc.integer({ min: 1, max: 3 }), fc.array(partArb, { minLength: 2, maxLength: maxParts, size: 'max' }))
    .chain(([nSw, raw]) => {
      const spec: CircuitSpec = { types: [], props: [], wires: [] };
      for (let i = 0; i < nSw; i++) {
        spec.types.push('switch');
        spec.props!.push({ width: [1, 4, 8][i % 3]!, value: 0 });
      }
      for (const [t, w, c, v] of raw) {
        const type = types[t]!;
        spec.types.push(type);
        spec.props!.push(propsFor(type, w, c, v));
      }
      const parts = spec.types.map((_, i) => mkPart(spec, i));
      const inPins: [part: number, pin: number, width: number][] = [];
      const outPins: [part: number, out: number, width: number][] = [];
      parts.forEach((p, i) => {
        ins(p).forEach((s, k) => inPins.push([i, k, s.width]));
        outs(p).forEach((s, k) => outPins.push([i, k, s.width]));
      });
      return fc
        .tuple(
          fc.array(fc.nat(), { minLength: inPins.length, maxLength: inPins.length }),
          fc.array(fc.tuple(fc.nat(), fc.nat(), fc.boolean()), { maxLength: 3 }),
        )
        .map(([choices, extra]) => {
          const wires: WireSpec[] = [];
          inPins.forEach(([part, pin, w], k) => {
            const cands = outPins.filter(([q, , ow]) => ow === w && (!acyclic || q < part));
            const d = pickDriver(choices[k]!, cands);
            if (d) wires.push([d[0], part, pin, d[1]]);
          });
          // Extra wires: tri-state buses (outputs joined, tri-states preferred) or a second driver.
          for (const [a, b, joinOutputs] of extra) {
            if (!outPins.length) break;
            const tri = outPins.filter(([q]) => spec.types[q] === 'tristate');
            const pool = tri.length >= 2 && a % 3 !== 0 ? tri : outPins;
            const [fp, fo, fw] = pool[a % pool.length]!;
            if (joinOutputs) {
              const same = pool.filter(([q, o, w]) => w === fw && (q !== fp || o !== fo));
              if (!same.length) continue;
              const [tp, to] = same[b % same.length]!;
              wires.push([fp, tp, -1, fo, to]);
            } else {
              const sinks = inPins.filter(([q, , w]) => w === fw && (!acyclic || q > fp));
              if (!sinks.length) continue;
              const [tp, tpin] = sinks[b % sinks.length]!;
              wires.push([fp, tp, tpin, fo]);
            }
          }
          return { ...spec, wires };
        });
    });
}

const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 8, arbitrary: fc.tuple(fc.nat(), fc.nat()).map(([sw, value]): Step => ({ op: 'toggle', sw, value })) },
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
  /** Circuits with a tri-state, a multi-bit net, or a block. */
  triCircuits: number;
  busCircuits: number;
  blockCircuits: number;
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
  triCircuits: 0,
  busCircuits: 0,
  blockCircuits: 0,
});

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
  if (!nl.canRun) throw new Error(`generator produced a design that cannot run: ${JSON.stringify(nl.diagnostics)}`);
  const ref = new ReferenceEngine(nl, sc.opts);
  const fast = new FastEngine(nl, sc.opts);
  stats.timedParts += fast.prog.timedCount;
  stats.freeParts += fast.prog.freeCount;
  if (nl.parts.some((p) => p.kind === 'tristate')) stats.triCircuits++;
  if (nl.netWidth.some((w) => w > 1)) stats.busCircuits++;
  if (nl.parts.some((p) => p.block)) stats.blockCircuits++;
  const inputs = nl.parts.filter((p) => p.kind === 'switch' || p.kind === 'button');
  const blocks = nl.parts.filter((p) => p.block);

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
    if (!same(ref.netV, fast.netV) || !same(ref.netX, fast.netX)) fail(`nets ${[...ref.netV]}/${[...ref.netX]} vs ${[...fast.netV]}/${[...fast.netX]}`);
    const ri = ref.internalState();
    const fi = fast.internalState();
    if (!same(ri.slotV, fi.slotV) || !same(ri.slotX, fi.slotX) || !same(ri.slotZ, fi.slotZ)) fail('slots');
    if (!same(ri.stV, fi.stV) || !same(ri.stX, fi.stX)) fail(`dff state`);
    if (!same(ri.prevClk, fi.prevClk)) fail(`prev clk ${[...ri.prevClk]} vs ${[...fi.prevClk]}`);
    if (ri.blocks.join('|') !== fi.blocks.join('|')) fail('block state');
    if (ref.ticks !== fast.ticks || ref.clock !== fast.clock || ref.isPowered !== fast.isPowered) fail('clock/power');
    for (const p of inputs) if (ref.switchValue(p.id) !== fast.switchValue(p.id)) fail(`switch ${p.id}`);
    for (const p of blocks) if (!same(ref.memory(p.id), fast.memory(p.id))) fail(`memory ${p.id}`);
    for (const p of nl.parts) {
      for (const pin of [...p.inputPins, ...p.outputPins]) {
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
      if (!inputs.length) continue;
      const p = inputs[s.sw % inputs.length]!;
      if (p.kind === 'button') {
        const down = !ref.isSwitchOn(p.id);
        check(`press ${p.id}`, ref.press(p.id, down), fast.press(p.id, down), before);
      } else if (p.outputWidths[0] === 1 || s.value === undefined) {
        const on = !ref.isSwitchOn(p.id);
        check(`toggle ${p.id}`, ref.setSwitch(p.id, on), fast.setSwitch(p.id, on), before);
      } else {
        check(`set ${p.id}`, ref.setValue(p.id, s.value), fast.setValue(p.id, s.value), before);
      }
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
