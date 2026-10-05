import type { Board, Part, PartType } from '@build-a-computer/schema';
import type { BlockModel } from './blocks/types';
import { GATE_OPS, blockOf, kindOf, type PartBehavior, type PartKind } from './library';
import { PART_INFO, pinsOf, widthOf } from './parts-spec';
import { mask } from './values';

/** SIM-10: designs over these limits are refused before anything runs. */
export const LIMITS = { maxGates: 200_000, maxStateBytes: 64 * 1024 * 1024 } as const;

export type Diagnostic =
  | { code: 'floating-input'; part: string; pin: string }
  | { code: 'bad-wire'; wire: string }
  | { code: 'contention'; net: number; parts: string[] }
  | { code: 'unstable'; nets: number[] }
  /** E-SIM-04: pins of different widths joined on one net. The design cannot run. */
  | { code: 'width-mismatch'; net: number; pins: string[] }
  /** A part type the engine has no behavior for (yet). The design cannot run. */
  | { code: 'unsupported-part'; part: string };

/** Diagnostics that stop a design from running. */
export const BLOCKING: ReadonlySet<Diagnostic['code']> = new Set(['width-mismatch', 'unsupported-part']);

export class CompileError extends Error {
  constructor(
    /** too-large: over LIMITS.maxGates parts (E-SIM-06). too-much-state: over LIMITS.maxStateBytes.
     *  not-runnable: an engine was built on a netlist with blocking diagnostics (E-SIM-04). */
    readonly code: 'too-large' | 'too-much-state' | 'not-runnable',
    message: string,
  ) {
    super(message);
    this.name = 'CompileError';
  }
}

/** One part after compilation. Pin indexes point into the global pin arrays. */
export interface CompiledPart {
  id: string;
  type: PartType;
  label: string | undefined;
  /** The source part (props, for blocks). */
  part: Part;
  kind: PartKind;
  behavior: PartBehavior;
  /** Gate op (G_*) for kind 'gate', else -1. */
  op: number;
  /** props.width (with its default). */
  width: number;
  /** splitter/joiner chunk size. */
  chunk: number;
  /** Pin names, in pinsOf order. */
  inputPins: string[];
  outputPins: string[];
  inputWidths: number[];
  outputWidths: number[];
  /** Net index for each input pin. */
  inputNets: number[];
  /** Global output slot for each output pin; a part's slots are consecutive. */
  outputSlots: number[];
  /** Behavioral model for kind 'block'. */
  block: BlockModel<unknown> | null;
  /** Samples its 'clk' input on the rising edge (dff and clocked blocks). */
  clocked: boolean;
  /** Index of the 'clk' input, or -1. */
  clkInput: number;
  /** Keeps state across power off (ROM). */
  nonVolatile: boolean;
  /** True when the part sits on a feedback loop (through any part). */
  inLoop: boolean;
  /** Initial input value: switch value (1-bit: `on`), const value. */
  initialValue: number;
  initialOn: boolean;
}

export interface Netlist {
  parts: CompiledPart[];
  partIndex: Map<string, number>;
  netCount: number;
  /** Width of every net, in bits (the width of its first pin). */
  netWidth: Int32Array;
  /** For each output slot: the net it drives, the part that owns it, and its width. */
  slotNet: Int32Array;
  slotPart: Int32Array;
  slotWidth: Int32Array;
  /** For each net: the output slots driving it and the parts reading it. */
  netDrivers: number[][];
  netReaders: number[][];
  /** `${partId}:${pin}` -> net index. Every pin has a net, even when unconnected. */
  pinNet: Map<string, number>;
  /** `${partId}:${pin}` -> pin width. */
  pinWidth: Map<string, number>;
  /** wire id -> net index. */
  wireNet: Map<string, number>;
  diagnostics: Diagnostic[];
  /** False when a blocking diagnostic (width mismatch, unsupported part) is present. */
  canRun: boolean;
  /** Estimated simulation state in bytes (nets, slots, memories). */
  stateBytes: number;
}

const fmt = (n: number) => n.toLocaleString('en');

/** Bytes of state a part needs beyond its pins: memories count 4 bytes per word. */
function partStateBytes(p: Part): number {
  if (PART_INFO[p.type]?.category !== 'memory') return 0;
  const aw = p.props?.addrWidth ?? PART_INFO[p.type].defaults.addrWidth;
  if (aw === undefined) return 8;
  return (2 ** aw) * 4;
}

/**
 * Turn a flat board into a netlist: pins joined by wires become nets
 * (union-find), widths are checked per net, and feedback loops are found
 * with Tarjan's algorithm. Throws CompileError (before allocating anything
 * large) when the design is over the SIM-10 limits.
 */
export function compile(board: Board): Netlist {
  const partCount = board.parts.filter((p) => p.type !== 'lamp').length;
  if (partCount > LIMITS.maxGates) {
    // E-SIM-06: refused before anything runs.
    throw new CompileError(
      'too-large',
      `This design has ${fmt(partCount)} parts; the limit is ${fmt(LIMITS.maxGates)}. Use verified blocks instead of raw gates.`,
    );
  }
  let memBytes = 0;
  for (const p of board.parts) memBytes += partStateBytes(p) + 64;
  if (memBytes > LIMITS.maxStateBytes) {
    throw new CompileError(
      'too-much-state',
      `This design needs about ${fmt(Math.ceil(memBytes / 2 ** 20))} MB of state; the limit is ${fmt(LIMITS.maxStateBytes / 2 ** 20)} MB. Use smaller memories.`,
    );
  }

  const diagnostics: Diagnostic[] = [];
  const parts = board.parts;

  // Number every pin.
  const pinIndex = new Map<string, number>();
  const pinKeys: string[] = [];
  const pinW: number[] = [];
  const specs = parts.map((p) => pinsOf(p));
  parts.forEach((p, pi) => {
    for (const pin of specs[pi]!) {
      const key = `${p.id}:${pin.name}`;
      if (pinIndex.has(key)) continue;
      pinIndex.set(key, pinKeys.length);
      pinKeys.push(key);
      pinW.push(pin.width);
    }
  });

  // Union pins joined by wires.
  const parent = Int32Array.from(pinKeys, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const wireRoot = new Map<string, number>();
  for (const w of board.wires) {
    const a = pinIndex.get(`${w.from.part}:${w.from.pin}`);
    const b = pinIndex.get(`${w.to.part}:${w.to.pin}`);
    if (a === undefined || b === undefined) {
      diagnostics.push({ code: 'bad-wire', wire: w.id });
      continue;
    }
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
    wireRoot.set(w.id, a);
  }

  // Dense net numbering; a net's width is its first pin's width.
  const rootNet = new Map<number, number>();
  const pinNet = new Map<string, number>();
  const pinWidth = new Map<string, number>();
  const widths: number[] = [];
  const netPins: number[][] = [];
  pinKeys.forEach((key, i) => {
    const r = find(i);
    let n = rootNet.get(r);
    if (n === undefined) {
      n = rootNet.size;
      rootNet.set(r, n);
      widths.push(pinW[i]!);
      netPins.push([]);
    }
    netPins[n]!.push(i);
    pinNet.set(key, n);
    pinWidth.set(key, pinW[i]!);
  });
  const netCount = rootNet.size;
  const wireNet = new Map<string, number>();
  for (const [id, pin] of wireRoot) wireNet.set(id, rootNet.get(find(pin))!);

  // E-SIM-04: every pin on a net must have the net's width.
  for (let n = 0; n < netCount; n++) {
    const pins = netPins[n]!;
    if (pins.length < 2) continue;
    if (pins.some((i) => pinW[i] !== widths[n])) {
      diagnostics.push({ code: 'width-mismatch', net: n, pins: pins.map((i) => pinKeys[i]!) });
    }
  }

  const netDrivers: number[][] = Array.from({ length: netCount }, () => []);
  const netReaders: number[][] = Array.from({ length: netCount }, () => []);
  const slotNet: number[] = [];
  const slotPart: number[] = [];
  const slotWidth: number[] = [];
  const seen = new Set<string>();
  const compiled: CompiledPart[] = [];
  parts.forEach((p, idx) => {
    if (seen.has(p.id)) return; // duplicate ids: the first one wins
    seen.add(p.id);
    const pi = compiled.length;
    const kind = kindOf(p.type);
    if (!kind) diagnostics.push({ code: 'unsupported-part', part: p.id });
    const spec = specs[idx]!;
    const ins = spec.filter((s) => s.dir === 'in');
    const outs = spec.filter((s) => s.dir === 'out');
    const inputNets = ins.map((s) => pinNet.get(`${p.id}:${s.name}`)!);
    const outputSlots = outs.map((s) => {
      const net = pinNet.get(`${p.id}:${s.name}`)!;
      const slot = slotNet.length;
      slotNet.push(net);
      slotPart.push(pi);
      slotWidth.push(s.width);
      netDrivers[net]!.push(slot);
      return slot;
    });
    for (const n of new Set(inputNets)) netReaders[n]!.push(pi);
    const block = kind === 'block' ? (blockOf(p.type) ?? null) : null;
    const clkInput = ins.findIndex((s) => s.name === 'clk');
    const width = widthOf(p);
    const clocked = kind === 'dff' || (kind === 'block' && !!block?.clock && clkInput >= 0);
    const value =
      p.type === 'switch' && width === 1
        ? p.on
          ? 1
          : (p.props?.value ?? 0) & 1
        : ((p.props?.value ?? 0) & mask(width)) >>> 0;
    compiled.push({
      id: p.id,
      type: p.type,
      label: p.label,
      part: p,
      kind: kind ?? 'block',
      behavior: { kind: kind ?? 'block' },
      op: GATE_OPS[p.type] ?? -1,
      width,
      chunk: p.props?.chunk ?? (PART_INFO[p.type]?.defaults.chunk as number | undefined) ?? 1,
      inputPins: ins.map((s) => s.name),
      outputPins: outs.map((s) => s.name),
      inputWidths: ins.map((s) => s.width),
      outputWidths: outs.map((s) => s.width),
      inputNets,
      outputSlots,
      block,
      clocked,
      clkInput,
      nonVolatile: kind === 'block' && (block?.nonVolatile ?? PART_INFO[p.type]?.nonVolatile ?? false),
      inLoop: false,
      initialValue: p.type === 'button' ? 0 : value,
      initialOn: value !== 0,
    });
  });

  compiled.forEach((p) => {
    p.inputNets.forEach((net, i) => {
      if (netDrivers[net]!.length === 0) diagnostics.push({ code: 'floating-input', part: p.id, pin: p.inputPins[i]! });
    });
  });

  markLoops(compiled, slotNet, netReaders);

  let stateBytes = netCount * 8 + slotNet.length * 12;
  for (const p of parts) stateBytes += partStateBytes(p) + 16;
  if (stateBytes > LIMITS.maxStateBytes) {
    throw new CompileError(
      'too-much-state',
      `This design needs about ${fmt(Math.ceil(stateBytes / 2 ** 20))} MB of state; the limit is ${fmt(LIMITS.maxStateBytes / 2 ** 20)} MB.`,
    );
  }

  return {
    parts: compiled,
    partIndex: new Map(compiled.map((p, i) => [p.id, i])),
    netCount,
    netWidth: Int32Array.from(widths),
    slotNet: Int32Array.from(slotNet),
    slotPart: Int32Array.from(slotPart),
    slotWidth: Int32Array.from(slotWidth),
    netDrivers,
    netReaders,
    pinNet,
    pinWidth,
    wireNet,
    diagnostics,
    canRun: !diagnostics.some((d) => BLOCKING.has(d.code)),
    stateBytes,
  };
}

/** Throws unless the netlist can run (engines call this; E-SIM-04). */
export function assertRunnable(nl: Netlist): void {
  if (nl.canRun) return;
  const d = nl.diagnostics.find((x) => BLOCKING.has(x.code))!;
  const msg =
    d.code === 'width-mismatch'
      ? `Bus width mismatch between ${d.pins.join(', ')}. Fix the wiring before running.`
      : d.code === 'unsupported-part'
        ? `Part ${d.part} cannot be simulated yet.`
        : 'This design cannot run.';
  throw new CompileError('not-runnable', msg);
}

/** Iterative Tarjan SCC over the part graph; flags parts on feedback loops. */
function markLoops(parts: CompiledPart[], slotNet: number[], netReaders: number[][]): void {
  const succ = (pi: number): number[] => {
    const out: number[] = [];
    for (const s of parts[pi]!.outputSlots) out.push(...netReaders[slotNet[s]!]!);
    return out;
  };
  const n = parts.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  let counter = 0;

  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
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
        const selfLoop = comp.length === 1 && frame.edges.includes(v);
        if (comp.length > 1 || selfLoop) for (const c of comp) parts[c]!.inLoop = true;
      }
    }
  }
}
