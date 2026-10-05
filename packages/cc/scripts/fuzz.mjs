#!/usr/bin/env node
/* global console, process */
/**
 * Generates random integer-arithmetic C programs (free of undefined
 * behavior) into packages/cc/programs/fuzz-NN.c, for differential testing
 * against riscv gcc (scripts/gcc-golden.mjs then src/programs.test.ts).
 *
 *   node packages/cc/scripts/fuzz.mjs [count=12] [firstSeed=1]
 *
 * Signed overflow is avoided by doing + - * and << in the unsigned type of
 * the same rank and converting back (implementation-defined, modulo in gcc);
 * division and remainder are guarded against 0 and MIN / -1; shift counts are
 * masked to the operand width.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../programs');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const count = Number(args[0] ?? 12);
const first = Number(args[1] ?? 1);

function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// name, C type, size, unsigned, rank
const TYPES = [
  { n: 'i8', c: 'signed char', size: 1, u: false, rank: 1 },
  { n: 'u8', c: 'unsigned char', size: 1, u: true, rank: 1 },
  { n: 'ch', c: 'char', size: 1, u: true, rank: 1 },
  { n: 'i16', c: 'short', size: 2, u: false, rank: 2 },
  { n: 'u16', c: 'unsigned short', size: 2, u: true, rank: 2 },
  { n: 'i32', c: 'int', size: 4, u: false, rank: 3 },
  { n: 'u32', c: 'unsigned', size: 4, u: true, rank: 3 },
  { n: 'l32', c: 'long', size: 4, u: false, rank: 4 },
  { n: 'i64', c: 'long long', size: 8, u: false, rank: 5 },
  { n: 'u64', c: 'unsigned long long', size: 8, u: true, rank: 5 },
  { n: 'b', c: '_Bool', size: 1, u: true, rank: 0 },
];
const T = Object.fromEntries(TYPES.map((t) => [t.n, t]));
const INT = T.i32;
const UINT = T.u32;

function promote(t) {
  if (t.rank < 3) return INT;
  return t;
}
function common(a, b) {
  a = promote(a);
  b = promote(b);
  if (a === b) return a;
  if (a.u === b.u) return a.rank >= b.rank ? a : b;
  const [u, s] = a.u ? [a, b] : [b, a];
  if (u.rank >= s.rank) return u;
  if (s.size > u.size) return s;
  return s.size === 8 ? T.u64 : UINT;
}
const unsignedOf = (t) => (t.size === 8 ? T.u64 : t.n === 'l32' ? 'unsigned long' : UINT);
const uname = (t) => {
  const u = unsignedOf(t);
  return typeof u === 'string' ? u : u.c;
};
const MIN = { i32: '(-2147483647 - 1)', l32: '(-2147483647L - 1)', i64: '(-9223372036854775807LL - 1)' };

function gen(seed) {
  const rnd = prng(seed * 7919 + 13);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const chance = (p) => rnd() < p;
  const vars = [];
  const decls = [];
  const lines = [];
  const randConst = (t) => {
    const r = rnd();
    let v;
    if (r < 0.3) v = Math.floor(rnd() * 10);
    else if (r < 0.5) v = -Math.floor(rnd() * 100);
    else if (r < 0.7) v = pick([0x7f, 0x80, 0xff, 0x7fff, 0x8000, 0xffff, 0x7fffffff, 0x80000000, 0xffffffff, -1, -128, -32768]);
    else v = Math.floor(rnd() * 4294967296) - 2147483648;
    if (t.size === 8 && chance(0.5)) {
      const hi = BigInt(Math.floor(rnd() * 4294967296)) << 32n;
      const big = (hi | BigInt(Math.floor(rnd() * 4294967296))) & 0x7fffffffffffffffn;
      return `${chance(0.3) ? '-' : ''}${big}LL`;
    }
    if (v < 0) return `(${v})`;
    return v > 0x7fffffff ? `${v}u` : String(v);
  };
  let id = 0;
  for (const t of TYPES) {
    const n = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) {
      const name = `${t.n}_${id++}`;
      const glob = chance(0.5);
      vars.push({ name, t, glob });
      const init = `${t.n === 'b' ? '' : `(${t.c})`}${randConst(t)}`;
      if (glob) decls.push(`static ${chance(0.2) ? 'volatile ' : ''}${t.c} ${name} = ${init};`);
      else lines.push(`  ${t.c} ${name} = ${init};`);
    }
  }
  const leaf = () => {
    if (chance(0.25)) {
      const t = pick(TYPES.filter((x) => x.n !== 'b'));
      return { code: `((${t.c})${randConst(t)})`, t };
    }
    const v = pick(vars);
    return { code: v.name, t: v.t };
  };
  const expr = (d) => {
    if (d <= 0 || chance(0.2)) return leaf();
    const k = rnd();
    if (k < 0.35) {
      const a = expr(d - 1);
      const b = expr(d - 1);
      const op = pick(['+', '-', '*', '&', '|', '^']);
      const ct = common(a.t, b.t);
      if (op === '&' || op === '|' || op === '^') return { code: `(${a.code} ${op} ${b.code})`, t: ct };
      if (ct.u) return { code: `(${a.code} ${op} ${b.code})`, t: ct };
      return { code: `((${ct.c})((${uname(ct)})${a.code} ${op} (${uname(ct)})${b.code}))`, t: ct };
    }
    if (k < 0.45) {
      const a = expr(d - 1);
      const b = expr(d - 1);
      const op = pick(['/', '%']);
      const ct = common(a.t, b.t);
      const min = MIN[ct.n];
      const guard = ct.u || !min ? `(${b.code}) == 0` : `(${b.code}) == 0 || ((${a.code}) == ${min} && (${b.code}) == -1)`;
      return { code: `((${guard}) ? (${ct.c})(${a.code}) : (${ct.c})(${a.code} ${op} ${b.code}))`, t: ct };
    }
    if (k < 0.55) {
      const a = expr(d - 1);
      const b = expr(d - 1);
      const pt = promote(a.t);
      const w = pt.size * 8 - 1;
      if (chance(0.5)) {
        const ut = uname(pt);
        return { code: `((${pt.c})((${ut})${a.code} << ((${b.code}) & ${w})))`, t: pt };
      }
      return { code: `(${a.code} >> ((${b.code}) & ${w}))`, t: pt };
    }
    if (k < 0.68) {
      const a = expr(d - 1);
      const b = expr(d - 1);
      const op = pick(['<', '<=', '>', '>=', '==', '!=', '&&', '||']);
      return { code: `(${a.code} ${op} ${b.code})`, t: INT };
    }
    if (k < 0.78) {
      const a = expr(d - 1);
      const op = pick(['-', '~', '!', '+']);
      const pt = promote(a.t);
      if (op === '!') return { code: `(!${a.code})`, t: INT };
      if (op === '-' && !pt.u) return { code: `((${pt.c})(0 - (${uname(pt)})${a.code}))`, t: pt };
      return { code: `(${op}${a.code})`, t: pt };
    }
    if (k < 0.88) {
      const a = expr(d - 1);
      const t = pick(TYPES);
      return { code: `((${t.c})${a.code})`, t };
    }
    const c = expr(d - 1);
    const a = expr(d - 1);
    const b = expr(d - 1);
    return { code: `(${c.code} ? ${a.code} : ${b.code})`, t: common(a.t, b.t) };
  };
  // helper functions with mixed parameter types
  const fns = [];
  for (let f = 0; f < 4; f++) {
    const np = 1 + Math.floor(rnd() * 11);
    const ps = Array.from({ length: np }, (_, i) => ({ name: `p${i}`, t: pick(TYPES) }));
    const rt = pick(TYPES.filter((x) => x.n !== 'b'));
    const saved = vars.splice(0, vars.length, ...ps.map((p) => ({ name: p.name, t: p.t, glob: false })));
    const body = expr(3);
    vars.splice(0, vars.length, ...saved);
    decls.push(`static ${rt.c} fn${f}(${ps.map((p) => `${p.t.c} ${p.name}`).join(', ')}) { return (${rt.c})${body.code}; }`);
    fns.push({ name: `fn${f}`, ps, rt });
  }
  const stmts = 60 + Math.floor(rnd() * 40);
  for (let s = 0; s < stmts; s++) {
    const v = pick(vars);
    const k = rnd();
    if (k < 0.55) {
      lines.push(`  ${v.name} = ${expr(2 + Math.floor(rnd() * 3)).code};`);
    } else if (k < 0.7 && (v.t.u && v.t.rank >= 3)) {
      const op = pick(['+=', '-=', '*=', '&=', '|=', '^=', '<<=', '>>=']);
      const e = expr(2).code;
      if (op === '<<=' || op === '>>=') lines.push(`  ${v.name} ${op} (${e}) & ${v.t.size * 8 - 1};`);
      else lines.push(`  ${v.name} ${op} (${v.t.c})(${e});`);
    } else if (k < 0.8 && v.t.rank < 3 && v.t.n !== 'b') {
      lines.push(`  ${pick([`${v.name}++`, `${v.name}--`, `++${v.name}`, `--${v.name}`])};`);
    } else if (k < 0.92) {
      const f = pick(fns);
      lines.push(`  ${v.name} = ${f.name}(${f.ps.map(() => expr(2).code).join(', ')});`);
    } else {
      lines.push(`  if (${expr(2).code}) ${v.name} = ${expr(2).code}; else ${pick(vars).name} = ${expr(1).code};`);
    }
    lines.push(`  ${v.t.size === 8 ? 'mixll' : 'mix'}((unsigned${v.t.size === 8 ? ' long long' : ''})${v.name});`);
  }
  for (const v of vars) lines.push(`  ${v.t.size === 8 ? 'mixll' : 'mix'}((unsigned${v.t.size === 8 ? ' long long' : ''})${v.name});`);
  return `/* Generated by scripts/fuzz.mjs (seed ${seed}). Integer semantics vs gcc. */
#include "prelude.h"
${decls.join('\n')}
int main(void) {
${lines.join('\n')}
  showu("hash", hash_);
  return (int)(hash_ & 0x7f);
}
`;
}


/**
 * Second kind: arrays, structs (by value too), pointers, loops, switch and
 * calls, on top of the same UB-free integer expressions.
 */
function gen2(seed) {
  const rnd = prng(seed * 104729 + 7);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const chance = (p) => rnd() < p;
  const SCALARS = TYPES.filter((t) => t.n !== 'b');
  const decls = [];
  const lines = [];
  const randConst = (t) => {
    const r = rnd();
    let v;
    if (r < 0.4) v = Math.floor(rnd() * 20);
    else if (r < 0.6) v = -Math.floor(rnd() * 300);
    else v = Math.floor(rnd() * 4294967296) - 2147483648;
    if (t.size === 8 && chance(0.3)) return `${Math.floor(rnd() * 2 ** 31)}LL * ${Math.floor(rnd() * 2 ** 31)}LL`;
    if (v < 0) return `(${v})`;
    return v > 0x7fffffff ? `${v}u` : String(v);
  };
  // struct types
  const structs = [];
  for (let k = 0; k < 2; k++) {
    const fields = [];
    const nf = 2 + Math.floor(rnd() * 4);
    for (let f = 0; f < nf; f++) {
      const t = pick(SCALARS);
      const arr = chance(0.25) ? 2 + Math.floor(rnd() * 3) : 0;
      const bits = !arr && t.size <= 4 && t.size > 1 && chance(0.2) ? 1 + Math.floor(rnd() * (t.size * 8 - 1)) : 0;
      fields.push({ name: `f${f}`, t, arr, bits });
    }
    structs.push({ name: `S${k}`, fields });
    decls.push(`struct S${k} { ${fields.map((f) => `${f.t.c} ${f.name}${f.arr ? `[${f.arr}]` : ''}${f.bits ? ` : ${f.bits}` : ''};`).join(' ')} };`);
  }
  const places = []; // lvalue generators: () => { code, t }
  const mixers = []; // code that mixes all state
  const mixOf = (code, t) => `${t.size === 8 ? 'mixll' : 'mix'}((unsigned${t.size === 8 ? ' long long' : ''})(${code}));`;
  let id = 0;
  const idx = (n) => `[(unsigned)(${exprD(1).code}) % ${n}u]`;
  // scalars
  for (let k = 0; k < 6; k++) {
    const t = pick(SCALARS);
    const name = `v${id++}`;
    const glob = chance(0.4);
    const init = `(${t.c})${randConst(t)}`;
    if (glob) decls.push(`static ${t.c} ${name} = ${init};`);
    else lines.push(`  ${t.c} ${name} = ${init};`);
    places.push(() => ({ code: name, t }));
    mixers.push(mixOf(name, t));
  }
  // arrays
  for (let k = 0; k < 3; k++) {
    const t = pick(SCALARS);
    const n = 3 + Math.floor(rnd() * 6);
    const name = `a${id++}`;
    const init = Array.from({ length: Math.floor(rnd() * (n + 1)) }, () => `(${t.c})${randConst(t)}`).join(', ');
    if (chance(0.5)) decls.push(`static ${t.c} ${name}[${n}] = { ${init || '0'} };`);
    else lines.push(`  ${t.c} ${name}[${n}] = { ${init || '0'} };`);
    places.push(() => ({ code: `${name}${idx(n)}`, t }));
    mixers.push(`{ int k_; for (k_ = 0; k_ < ${n}; k_++) ${mixOf(`${name}[k_]`, t)} }`);
  }
  // struct instances
  const sinsts = [];
  for (let k = 0; k < 3; k++) {
    const st = pick(structs);
    const name = `s${id++}`;
    const init = st.fields.map((f) => (f.arr ? `{ ${randConst(f.t)} }` : `${randConst(f.t)}`)).join(', ');
    if (chance(0.5)) decls.push(`static struct ${st.name} ${name} = { ${init} };`);
    else lines.push(`  struct ${st.name} ${name} = { ${init} };`);
    sinsts.push({ name, st });
    for (const f of st.fields) {
      const ft = f.bits ? INT : f.t;
      places.push(() => ({ code: `${name}.${f.name}${f.arr ? idx(f.arr) : ''}`, t: ft }));
      if (f.arr) mixers.push(`{ int k_; for (k_ = 0; k_ < ${f.arr}; k_++) ${mixOf(`${name}.${f.name}[k_]`, f.t)} }`);
      else mixers.push(mixOf(`${name}.${f.name}`, ft));
    }
  }
  // pointers to struct instances
  for (const si of sinsts.slice(0, 2)) {
    const pname = `p${id++}`;
    lines.push(`  struct ${si.st.name} *${pname} = &${si.name};`);
    for (const f of si.st.fields) {
      const ft = f.bits ? INT : f.t;
      places.push(() => ({ code: `${pname}->${f.name}${f.arr ? idx(f.arr) : ''}`, t: ft }));
    }
  }
  const leaf = () => {
    if (chance(0.2)) {
      const t = pick(SCALARS);
      return { code: `((${t.c})${randConst(t)})`, t };
    }
    return pick(places)();
  };
  let depthGuard = 0;
  function exprD(d) {
    depthGuard++;
    try {
      if (d <= 0 || depthGuard > 6 || chance(0.25)) return leaf();
      const k = rnd();
      if (k < 0.4) {
        const a = exprD(d - 1);
        const b = exprD(d - 1);
        const op = pick(['+', '-', '*', '&', '|', '^']);
        const ct = common(a.t, b.t);
        if (op === '&' || op === '|' || op === '^' || ct.u) return { code: `(${a.code} ${op} ${b.code})`, t: ct };
        return { code: `((${ct.c})((${uname(ct)})${a.code} ${op} (${uname(ct)})${b.code}))`, t: ct };
      }
      if (k < 0.5) {
        const a = exprD(d - 1);
        const b = exprD(d - 1);
        const ct = common(a.t, b.t);
        const min = MIN[ct.n];
        const guard = ct.u || !min ? `(${b.code}) == 0` : `(${b.code}) == 0 || ((${a.code}) == ${min} && (${b.code}) == -1)`;
        return { code: `((${guard}) ? (${ct.c})(${a.code}) : (${ct.c})(${a.code} ${pick(['/', '%'])} ${b.code}))`, t: ct };
      }
      if (k < 0.6) {
        const a = exprD(d - 1);
        const b = exprD(d - 1);
        const pt = promote(a.t);
        const w = pt.size * 8 - 1;
        if (chance(0.5)) return { code: `((${pt.c})((${uname(pt)})${a.code} << ((${b.code}) & ${w})))`, t: pt };
        return { code: `(${a.code} >> ((${b.code}) & ${w}))`, t: pt };
      }
      if (k < 0.75) {
        const a = exprD(d - 1);
        const b = exprD(d - 1);
        return { code: `(${a.code} ${pick(['<', '<=', '>', '>=', '==', '!=', '&&', '||'])} ${b.code})`, t: INT };
      }
      if (k < 0.85) {
        const a = exprD(d - 1);
        const t = pick(TYPES);
        return { code: `((${t.c})${a.code})`, t };
      }
      if (k < 0.92 && fns.length) {
        const f = pick(fns);
        return { code: f.call(), t: f.rt };
      }
      const c = exprD(d - 1);
      const a = exprD(d - 1);
      const b = exprD(d - 1);
      return { code: `(${c.code} ? ${a.code} : ${b.code})`, t: common(a.t, b.t) };
    } finally {
      depthGuard--;
    }
  }
  // functions: one takes a struct by value and returns one, one walks an array through a pointer
  const fns = [];
  {
    const st = pick(structs);
    const f0 = st.fields[0];
    decls.push(`static struct ${st.name} bump(struct ${st.name} x, int k) { x.${f0.name}${f0.arr ? '[0]' : ''} += (${f0.t.c})k; return x; }`);
    const t = pick(SCALARS);
    decls.push(`static ${t.c} total(const ${t.c} *p, int n) { ${t.c} s = 0; int i; for (i = 0; i < n; i++) s ^= (${t.c})(p[i] + (${t.c})i); return s; }`);
    const arrs = places.filter(() => true);
    void arrs;
    fns.push({ rt: t, call: () => `total((const ${t.c} *)0 == 0 ? (const ${t.c} *)&tz_[0] : 0, 4)` });
    decls.push(`static ${t.c} tz_[4] = { 1, 2, 3, 4 };`);
    const si = sinsts.find((x) => x.st === st);
    if (si) {
      lines.push(`  /* bump: struct by value */`);
      fns.push({ rt: f0.t, call: () => `bump(${si.name}, ${Math.floor(rnd() * 9)}).${f0.name}${f0.arr ? '[0]' : ''}` });
    }
  }
  const stmt = (depth) => {
    const k = rnd();
    const pl = pick(places)();
    if (k < 0.45 || depth > 2) {
      const e = exprD(2 + Math.floor(rnd() * 2));
      return `${pl.code} = (${pl.t.c})${e.code};`;
    }
    if (k < 0.55 && pl.t.u && pl.t.rank >= 3) {
      return `${pl.code} ${pick(['+=', '-=', '*=', '^=', '|='])} (${pl.t.c})(${exprD(2).code});`;
    }
    if (k < 0.7) {
      const n = 1 + Math.floor(rnd() * 5);
      const iv = `i${id++}`;
      return `{ int ${iv}; for (${iv} = 0; ${iv} < ${n}; ${iv}++) { ${stmt(depth + 1)} ${chance(0.3) ? `if ((${exprD(1).code}) & 1) continue;` : ''} ${stmt(depth + 1)} } }`;
    }
    if (k < 0.8) {
      return `if (${exprD(2).code}) { ${stmt(depth + 1)} } else { ${stmt(depth + 1)} }`;
    }
    if (k < 0.88) {
      const cases = Array.from({ length: 2 + Math.floor(rnd() * 3) }, (_, c) => `case ${c}: ${stmt(depth + 1)} ${chance(0.7) ? 'break;' : ''}`);
      return `switch ((unsigned)(${exprD(1).code}) % 5u) { ${cases.join(' ')} default: ${stmt(depth + 1)} }`;
    }
    if (k < 0.94 && sinsts.length >= 2) {
      const a = pick(sinsts);
      const b = sinsts.find((x) => x !== a && x.st === a.st);
      if (b) return `${a.name} = ${b.name};`;
      return `${a.name} = bump_ok_(${a.name});`.replace(/bump_ok_\(([^)]*)\)/, '$1');
    }
    const n = 1 + Math.floor(rnd() * 4);
    const wv = `w${id++}`;
    return `{ int ${wv} = ${n}; do { ${stmt(depth + 1)} } while (--${wv} > 0); }`;
  };
  const body = [];
  const ns = 30 + Math.floor(rnd() * 20);
  for (let s2 = 0; s2 < ns; s2++) {
    body.push(`  ${stmt(0)}`);
    if (s2 % 5 === 4) body.push(`  ${pick(mixers)}`);
  }
  for (const m of mixers) body.push(`  ${m}`);
  return `/* Generated by scripts/fuzz.mjs --kind=struct (seed ${seed}). */
#include "prelude.h"
${decls.join('\n')}
int main(void) {
${lines.join('\n')}
${body.join('\n')}
  showu("hash", hash_);
  return (int)(hash_ & 0x7f);
}
`;
}

const kind = process.argv.find((a) => a.startsWith('--kind='))?.slice(7) ?? 'int';
for (let i = 0; i < count; i++) {
  const seed = first + i;
  const name = `${kind === 'struct' ? 'fuzzs' : 'fuzz'}-${String(seed).padStart(3, '0')}.c`;
  writeFileSync(join(out, name), kind === 'struct' ? gen2(seed) : gen(seed));
}
console.log(`wrote ${count} programs`);
