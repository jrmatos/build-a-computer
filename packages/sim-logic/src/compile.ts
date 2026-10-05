import type { Board, PartType } from '@ground-up/schema';
import { LIBRARY, type PartBehavior } from './library';

export const LIMITS = { maxGates: 200_000 } as const;

export type Diagnostic =
  | { code: 'floating-input'; part: string; pin: string }
  | { code: 'bad-wire'; wire: string }
  | { code: 'contention'; net: number; parts: string[] }
  | { code: 'unstable'; nets: number[] };

export class CompileError extends Error {
  constructor(
    readonly code: 'too-large',
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
  behavior: PartBehavior;
  /** Net index for each input pin, in library order. */
  inputNets: number[];
  /** Global output slot for each output pin, in library order. */
  outputSlots: number[];
  /** True when the part sits on a combinational feedback loop. */
  inLoop: boolean;
  initialOn: boolean;
}

export interface Netlist {
  parts: CompiledPart[];
  partIndex: Map<string, number>;
  netCount: number;
  /** For each output slot: the net it drives and the part that owns it. */
  slotNet: Int32Array;
  slotPart: Int32Array;
  /** For each net: the output slots driving it and the parts reading it. */
  netDrivers: number[][];
  netReaders: number[][];
  /** `${partId}:${pin}` -> net index. Every pin has a net, even when unconnected. */
  pinNet: Map<string, number>;
  /** wire id -> net index. */
  wireNet: Map<string, number>;
  diagnostics: Diagnostic[];
}

/**
 * Turn a board into a netlist: pins joined by wires become nets (union-find),
 * and feedback loops are found with Tarjan's algorithm.
 */
export function compile(board: Board): Netlist {
  const known = board.parts.filter((p) => LIBRARY[p.type]);
  const gateCount = known.filter((p) => LIBRARY[p.type]!.behavior.kind !== 'lamp').length;
  if (gateCount > LIMITS.maxGates) {
    // E-SIM-06: refused before anything runs.
    throw new CompileError(
      'too-large',
      `This design has ${gateCount.toLocaleString('en')} parts; the limit is ${LIMITS.maxGates.toLocaleString('en')}. Use verified blocks instead of raw gates.`,
    );
  }

  // Number every pin.
  const pinIndex = new Map<string, number>();
  const pinKeys: string[] = [];
  for (const p of known) {
    const lib = LIBRARY[p.type]!;
    for (const pin of [...lib.inputs, ...lib.outputs]) {
      const key = `${p.id}:${pin}`;
      pinIndex.set(key, pinKeys.length);
      pinKeys.push(key);
    }
  }

  // Union pins joined by wires.
  const parent = Int32Array.from(pinKeys, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const diagnostics: Diagnostic[] = [];
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

  // Dense net numbering.
  const rootNet = new Map<number, number>();
  const pinNet = new Map<string, number>();
  pinKeys.forEach((key, i) => {
    const r = find(i);
    let n = rootNet.get(r);
    if (n === undefined) {
      n = rootNet.size;
      rootNet.set(r, n);
    }
    pinNet.set(key, n);
  });
  const netCount = rootNet.size;
  const wireNet = new Map<string, number>();
  for (const [id, pin] of wireRoot) wireNet.set(id, rootNet.get(find(pin))!);

  const netDrivers: number[][] = Array.from({ length: netCount }, () => []);
  const netReaders: number[][] = Array.from({ length: netCount }, () => []);
  const slotNet: number[] = [];
  const slotPart: number[] = [];
  const parts: CompiledPart[] = known.map((p, pi) => {
    const lib = LIBRARY[p.type]!;
    const inputNets = lib.inputs.map((pin) => pinNet.get(`${p.id}:${pin}`)!);
    const outputSlots = lib.outputs.map((pin) => {
      const net = pinNet.get(`${p.id}:${pin}`)!;
      const slot = slotNet.length;
      slotNet.push(net);
      slotPart.push(pi);
      netDrivers[net]!.push(slot);
      return slot;
    });
    for (const n of new Set(inputNets)) netReaders[n]!.push(pi);
    return {
      id: p.id,
      type: p.type,
      label: p.label,
      behavior: lib.behavior,
      inputNets,
      outputSlots,
      inLoop: false,
      initialOn: p.on ?? false,
    };
  });

  parts.forEach((p) => {
    p.inputNets.forEach((net, i) => {
      if (netDrivers[net]!.length === 0) {
        diagnostics.push({ code: 'floating-input', part: p.id, pin: LIBRARY[p.type]!.inputs[i]! });
      }
    });
  });

  markLoops(parts, slotNet, netReaders);

  return {
    parts,
    partIndex: new Map(parts.map((p, i) => [p.id, i])),
    netCount,
    slotNet: Int32Array.from(slotNet),
    slotPart: Int32Array.from(slotPart),
    netDrivers,
    netReaders,
    pinNet,
    wireNet,
    diagnostics,
  };
}

/** Iterative Tarjan SCC over the part graph; flags parts on combinational loops. */
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
