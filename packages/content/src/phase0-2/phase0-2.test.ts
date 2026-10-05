import { describe, expect, it } from 'vitest';
import { Level, type PartType } from '@ground-up/schema';
import { REFERENCES, REFERENCE_SIGNATURES } from '@ground-up/sim-logic';
import { LEVELS } from '../index';
import { PHASE0_2_LEVELS } from './index';
import { MODELS } from './models';
import { solutionFor } from '../../solutions/phase0-2';
import { allPass, firstFailure, pendingReason } from '../../solutions/harness';

const ORDER: Record<number, string[]> = {
  0: ['wires-and-lamps', 'switches', 'meet-nand'],
  1: ['not-gate', 'and-gate', 'or-gate', 'nor-gate', 'xor-gate', 'xnor-gate', 'and3-gate', 'mux', 'demux', 'decoder-2to4'],
  2: [
    'binary-counting',
    'half-adder',
    'full-adder',
    'adder-8bit',
    'negation',
    'subtractor',
    'equality',
    'less-than',
    'logic-unit',
    'shifter',
    'alu-8bit',
    'alu-32bit',
  ],
};

describe('Phase 0-2 levels', () => {
  it('follow the plan: 3 + 10 + 12 levels, in order, with the kept ids', () => {
    for (const [phase, ids] of Object.entries(ORDER)) {
      const got = PHASE0_2_LEVELS.filter((l) => l.phase === Number(phase)).sort((a, b) => a.order - b.order);
      expect(got.map((l) => l.id)).toEqual(ids);
      expect(got.map((l) => l.order)).toEqual(ids.map((_, i) => i + 1));
    }
  });

  it('validate with Level.parse and are drafts with no unverified resources', () => {
    for (const l of PHASE0_2_LEVELS) {
      expect(() => Level.parse(l), l.id).not.toThrow();
      expect(l.draft, l.id).toBe(true);
      expect(l.resources, l.id).toEqual([]);
      expect(l.tests.length, l.id).toBeGreaterThan(0);
      expect(l.hints.length, l.id).toBeGreaterThanOrEqual(1);
      expect(l.hints.length, l.id).toBeLessThanOrEqual(3);
      expect(l.tutorial.length, l.id).toBeGreaterThan(0);
      expect(l.afterword.length, l.id).toBeGreaterThan(0);
    }
  });

  it('palettes only grow along the track', () => {
    let prev: PartType[] = [];
    for (const l of PHASE0_2_LEVELS) {
      for (const p of prev) expect(l.palette, `${l.id} lost ${p}`).toContain(p);
      prev = l.palette;
    }
  });

  it('every test names labelled starter parts and a known model', () => {
    for (const l of PHASE0_2_LEVELS) {
      const ins = new Set(l.starter.parts.filter((p) => p.type === 'switch').map((p) => p.label));
      const outs = new Set(l.starter.parts.filter((p) => p.type === 'lamp').map((p) => p.label));
      for (const t of l.tests) {
        if (t.kind === 'truth-table') {
          for (const r of t.rows) {
            for (const k of Object.keys(r.inputs)) expect(ins.has(k), `${l.id} input ${k}`).toBe(true);
            for (const k of Object.keys(r.expect)) expect(outs.has(k), `${l.id} output ${k}`).toBe(true);
          }
        } else if (t.kind === 'exhaustive' || t.kind === 'random') {
          for (const k of t.inputs) expect(ins.has(k), `${l.id} input ${k}`).toBe(true);
          for (const k of t.outputs) expect(outs.has(k), `${l.id} output ${k}`).toBe(true);
          expect(MODELS[t.reference], `${l.id} model ${t.reference}`).toBeDefined();
        }
      }
    }
  });
});

describe('LVL-01: unlock graph over every level', () => {
  const byId = new Map(LEVELS.map((l) => [l.id, l]));

  it('every requirement exists', () => {
    for (const l of LEVELS) for (const r of l.requires) expect(byId.has(r), `${l.id} requires ${r}`).toBe(true);
  });

  it('has no cycles', () => {
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string, path: string[]): void => {
      if (state.get(id) === 'done') return;
      expect(state.get(id), `cycle: ${[...path, id].join(' -> ')}`).not.toBe('visiting');
      state.set(id, 'visiting');
      for (const r of byId.get(id)?.requires ?? []) visit(r, [...path, id]);
      state.set(id, 'done');
    };
    for (const l of LEVELS) visit(l.id, []);
  });

  it('every level is reachable', () => {
    const done = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const l of LEVELS) {
        if (!done.has(l.id) && l.requires.every((r) => done.has(r))) {
          done.add(l.id);
          changed = true;
        }
      }
    }
    expect([...LEVELS.map((l) => l.id)].filter((id) => !done.has(id))).toEqual([]);
  });
});

describe('Phase 0-2 reference solutions', () => {
  for (const level of PHASE0_2_LEVELS) {
    const solution = solutionFor(level);

    it(`${level.id}: has a solution built from its palette`, () => {
      expect(solution, level.id).toBeDefined();
      const locked = new Set(level.starter.parts.map((p) => p.id));
      for (const p of solution!.parts) {
        if (!locked.has(p.id)) expect(level.palette, `${level.id} uses ${p.type}`).toContain(p.type);
      }
      for (const p of level.starter.parts) expect(solution!.parts).toContainEqual(p);
    });

    const startReason = pendingReason(level, level.starter);
    it.skipIf(startReason !== null)(`E-RES-06: ${level.id}: the empty starter board fails${startReason ? ` (pending: ${startReason})` : ''}`, () => {
      expect(allPass(level, level.starter)).toBe(false);
    });

    const reason = solution ? pendingReason(level, solution) : null;
    it.skipIf(reason !== null)(`${level.id}: the reference solution passes every test${reason ? ` (pending: ${reason})` : ''}`, () => {
      expect(firstFailure(level, solution!)).toBeNull();
    });
  }

  it('every 1-bit level is checkable now (no pending engine features)', () => {
    const oneBit = [...ORDER[0]!, ...ORDER[1]!, 'half-adder', 'full-adder'];
    for (const id of oneBit) {
      const l = PHASE0_2_LEVELS.find((x) => x.id === id)!;
      expect(pendingReason(l, solutionFor(l)!), id).toBeNull();
    }
  });
});

describe('content models agree with sim-logic REFERENCES', () => {
  const used = new Map<string, { inputs: string[]; outputs: string[]; widths: Record<string, number> }>();
  for (const l of PHASE0_2_LEVELS) {
    for (const t of l.tests) {
      if (t.kind !== 'exhaustive' && t.kind !== 'random') continue;
      const widths = Object.fromEntries(l.starter.parts.map((p) => [p.label ?? p.id, p.props?.width ?? 1]));
      used.set(t.reference, { inputs: t.inputs, outputs: t.outputs, widths });
    }
  }
  for (const [name, sig] of used) {
    it.skipIf(!REFERENCES[name])(`${name}: model matches REFERENCES.${name}${REFERENCES[name] ? '' : ' (pending: reference not written)'}`, () => {
      let s = 12345;
      const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0);
      for (let k = 0; k < 300; k++) {
        const i: Record<string, number> = {};
        for (const label of sig.inputs) {
          const w = sig.widths[label] ?? 1;
          i[label] = (rnd() ^ (rnd() << 16)) >>> 0 & (w >= 32 ? 0xffffffff : (1 << w) - 1);
          i[label] >>>= 0;
        }
        const want = MODELS[name]!(i);
        const got = REFERENCES[name]!(i);
        for (const o of sig.outputs) expect(got[o], `${name}(${JSON.stringify(i)}).${o}`).toBe(want[o]);
      }
    });
  }
});

describe('every shared model name agrees with REFERENCE_SIGNATURES', () => {
  const sigs = REFERENCE_SIGNATURES as Record<string, { inputs: { name: string; width: number }[]; outputs: { name: string }[] }>;
  for (const name of Object.keys(MODELS).filter((n) => sigs[n] && REFERENCES[n])) {
    it(`${name}: same outputs over random inputs`, () => {
      let s = 99;
      const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0);
      for (let k = 0; k < 200; k++) {
        const i: Record<string, number> = {};
        for (const { name: label, width } of sigs[name]!.inputs) i[label] = ((rnd() ^ (rnd() << 16)) & (width >= 32 ? 0xffffffff : (1 << width) - 1)) >>> 0;
        const want = MODELS[name]!(i);
        const got = REFERENCES[name]!(i);
        for (const { name: o } of sigs[name]!.outputs) expect(got[o], `${name}(${JSON.stringify(i)}).${o}`).toBe(want[o]);
      }
    });
  }
});
