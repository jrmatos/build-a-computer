import type { Board, Level, PartType } from '@ground-up/schema';
import { BLOCKS, REFERENCES, ReferenceEngine, compile, loadProgram, runTest } from '@ground-up/sim-logic';
import type { TestSpec } from '@ground-up/schema';

/**
 * Test-only helpers for content checks. Multi-bit nets, block models and the
 * exhaustive/random checkers land in sim-logic concurrently with this
 * content; until they do, `pendingReason` names what is missing so the
 * content tests skip (and say why) instead of failing for the wrong reason.
 */

const BLOCK_TYPES: PartType[] = ['register', 'counter', 'ram', 'rom', 'mux', 'decoder', 'adder', 'alu'];
const BUS_TYPES: PartType[] = ['splitter', 'joiner', 'const', 'buffer', 'tristate'];

const engineHasSetValue = (): boolean => typeof (ReferenceEngine.prototype as unknown as Record<string, unknown>)['setValue'] === 'function';

function kindSupported(kind: string): boolean {
  try {
    const nl = compile({ parts: [], wires: [] });
    const test =
      kind === 'truth-table'
        ? { kind, rows: [{ inputs: {}, expect: {} }] }
        : kind === 'sequence'
          ? { kind, steps: [{ ticks: 0 }] }
          : kind === 'program'
            ? { kind, program: '', rom: 'ROM', halt: 'HALT', maxCycles: 1, expect: {} }
            : { kind, inputs: ['A'], outputs: ['Y'], reference: Object.keys(REFERENCES)[0] ?? '?', count: 1, seed: 1 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runTest(nl, test as any).next();
    return true;
  } catch (e) {
    return !/not implemented/i.test(String((e as Error)?.message ?? e));
  }
}

/** Why `board` cannot be checked against `level` yet, or null when it can. */
export function pendingReason(level: Level, board: Board): string | null {
  const parts = [...level.starter.parts, ...board.parts];
  const multiBit = parts.some((p) => (p.props?.width ?? 1) > 1 || BUS_TYPES.includes(p.type) || BLOCK_TYPES.includes(p.type));
  if (multiBit && !engineHasSetValue()) return 'engine has no multi-bit support (ReferenceEngine.setValue)';
  for (const p of parts) if (BLOCK_TYPES.includes(p.type) && !BLOCKS[p.type]) return `no block model for '${p.type}'`;
  for (const t of level.tests) {
    if (!kindSupported(t.kind)) return `checker kind '${t.kind}' not implemented`;
    if ((t.kind === 'exhaustive' || t.kind === 'random') && !REFERENCES[t.reference]) return `no reference '${t.reference}'`;
  }
  return null;
}

/** True when every case of every test of `level` passes on `board`. */
export function allPass(level: Level, board: Board): boolean {
  return level.tests.every((t) => [...cases(level, board, t)].every((r) => r.pass));
}

/** Run one test the way the worker does: program tests patch the ROM first; the level's power mode applies. */
function cases(level: Level, board: Board, t: TestSpec) {
  const nl = compile(t.kind === 'program' ? loadProgram(board, t) : board);
  return runTest(nl, t, { powerOnState: level.power });
}

/** The first failing case, for readable assertion messages. */
export function firstFailure(level: Level, board: Board): string | null {
  for (const [k, t] of level.tests.entries()) {
    for (const r of cases(level, board, t)) {
      if (!r.pass) return `test ${k} (${t.kind}) case ${r.index}: in ${JSON.stringify(r.inputs)} want ${JSON.stringify(r.expected)} got ${JSON.stringify(r.actual)} ${r.message ?? ''}`;
    }
  }
  return null;
}
