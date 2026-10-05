/**
 * CC-07 differential harness: compile each C corpus program with our compiler
 * (packages/cc), assemble and link it with packages/asm, run it on
 * packages/rv32, and compare the UART output and exit code with the golden
 * output that riscv gcc's build of the same program produced on the same
 * emulator (packages/cc/corpus/golden/*.json, made by generate.mjs).
 *
 * Machine (docs/code-levels.md): 1 MiB RAM at 0x8000_0000, sp = top of RAM,
 * ra = boot-ROM exit stub, entry `_start` (ref/crt0.s or libc's crt0), exit
 * through `ecall` with a7 = 93.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type LinkResult, type SourceFile, build } from '../../packages/asm/src/index';
import { compile, type CcDiagnostic } from '../../packages/cc/src/index';
import { Machine, RAM_BASE, asm } from '../../packages/rv32/src/index';
import {
  EXIT_STUB_ADDR,
  SYS_EXIT,
  installStopHook,
  runMachine,
} from '../../packages/rv-check/src/machine';

const here = dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = join(here, '../../packages/cc/corpus');
export const GOLDEN_DIR = join(CORPUS_DIR, 'golden');
export const REF_DIR = join(here, 'ref');

export const RAM_SIZE = 1024 * 1024;
export const STEP_LIMIT = 20_000_000;
/** Stop collecting UART output past this many bytes (a runaway program). */
export const UART_LIMIT = 1 << 20;

export type Group = 'free' | 'libc';

/** Same rule as generate.mjs: programs that include a libc header use libc. */
const LIBC_INCLUDE = /^\s*#\s*include\s*<(stdio|stdlib|string)\.h>/m;

export const groupOf = (source: string): Group => (LIBC_INCLUDE.test(source) ? 'libc' : 'free');

export interface CorpusProgram {
  /** File name without `.c`, e.g. `050-sorting`. */
  name: string;
  file: string;
  source: string;
  group: Group;
}

export function listCorpus(): CorpusProgram[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.c'))
    .sort()
    .map((file) => {
      const source = readFileSync(join(CORPUS_DIR, file), 'utf8');
      return { name: file.slice(0, -2), file, source, group: groupOf(source) };
    });
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** packages/cc/corpus/golden/<name>.json */
export interface Golden {
  source: string;
  /** SHA-256 of the C source the golden was made from (stale-golden check). */
  sourceSha256: string;
  group: Group;
  tool: string;
  /** Exact UART output (bytes as latin1 characters; the corpus prints ASCII). */
  uart: string;
  exitCode: number;
  /** Instructions the gcc -O2 build ran. */
  steps: number;
  /** gcc -O2 flat image at 0x8000_0000, base64; entry is the base. */
  image: string;
}

export function readGolden(name: string): Golden | undefined {
  const p = join(GOLDEN_DIR, `${name}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Golden) : undefined;
}

export interface RunResult {
  /** How it ended: exit (ecall a7 = 93), ebreak, an unhandled trap, or out of steps. */
  end: 'exit' | 'ebreak' | 'trap' | 'timeout' | 'wfi';
  exitCode: number | null;
  uart: string;
  steps: number;
  /** Human-readable end, e.g. "exit 3" or "trap cause 2 at 0x80000124 (tval 0x0)". */
  detail: string;
}

const hex32 = (v: number): string => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;

/** Run a flat image (loaded at the RAM base) on a fresh machine. */
export function runImage(image: Uint8Array, entry: number = RAM_BASE): RunResult {
  const tx: number[] = [];
  const m = new Machine({
    ramSize: RAM_SIZE,
    onUartTx: (b) => {
      if (tx.length < UART_LIMIT) tx.push(b);
    },
  });
  const stub = new Uint8Array(new Uint32Array([asm('addi', 17, 0, SYS_EXIT), asm('ecall')]).buffer);
  m.loadRom(stub, EXIT_STUB_ADDR);
  if (image.length > RAM_SIZE - 64 * 1024)
    throw new Error(`image too large (${image.length} bytes)`);
  if (image.length) m.load(RAM_BASE, image);
  m.hart.pc = entry;
  m.hart.x[2] = (RAM_BASE + RAM_SIZE) | 0;
  m.hart.x[1] = EXIT_STUB_ADDR;
  installStopHook(m);
  let steps = 0;
  let result: Omit<RunResult, 'uart' | 'steps'> | undefined;
  while (!result) {
    const left = STEP_LIMIT - steps;
    if (left <= 0) {
      result = {
        end: 'timeout',
        exitCode: null,
        detail: `no exit after ${STEP_LIMIT} steps (pc ${hex32(m.hart.pc)})`,
      };
      break;
    }
    const r = runMachine(m, Math.min(left, 1_000_000));
    steps += r.steps;
    if (r.stop) {
      const s = r.stop;
      if (s.kind === 'exit')
        result = { end: 'exit', exitCode: s.code >>> 0, detail: `exit ${s.code >>> 0}` };
      else if (s.kind === 'ebreak')
        result = { end: 'ebreak', exitCode: null, detail: `ebreak at ${hex32(s.pc)}` };
      else
        result = {
          end: 'trap',
          exitCode: null,
          detail: `unhandled trap cause ${s.cause} at pc ${hex32(s.pc)} (tval ${hex32(s.tval)})`,
        };
    } else if (r.reason === 'wfi') {
      result = {
        end: 'wfi',
        exitCode: null,
        detail: `wfi with nothing to wake it at ${hex32(m.hart.pc)}`,
      };
    }
  }
  return { ...result, uart: uartText(tx), steps };
}

/** Bytes as a latin1 string, in chunks (spreading a huge array overflows the stack). */
export const uartText = (bytes: Uint8Array | number[]): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 4096)
    s += String.fromCharCode(...Array.from(bytes.slice(i, i + 4096)));
  return s;
};

// ---------------------------------------------------------------------------
// Our toolchain

interface Libc {
  headers: Record<string, string>;
  sources: SourceFile[];
}

let libcCache: Promise<Libc | null> | undefined;

/** Normalize `{ name, text }[]`, `{ name, source }[]` or `Record<name, text>`. */
function toFiles(v: unknown): SourceFile[] {
  if (Array.isArray(v))
    return v.map(
      (f: {
        name?: string;
        path?: string;
        file?: string;
        text?: string;
        source?: string;
        content?: string;
      }) => ({
        name: f.name ?? f.path ?? f.file ?? 'libc',
        text: f.text ?? f.source ?? f.content ?? '',
      }),
    );
  if (v && typeof v === 'object')
    return Object.entries(v as Record<string, string>).map(([name, text]) => ({ name, text }));
  return [];
}

/** packages/libc, when it exists (it is written in parallel with this harness). */
export function loadLibc(): Promise<Libc | null> {
  libcCache ??= (async () => {
    const path = join(here, '../../packages/libc/src/index.ts');
    if (!existsSync(path)) return null;
    try {
      const mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
      const headers = toFiles(mod.LIBC_HEADERS);
      const sources = toFiles(mod.LIBC_SOURCES);
      if (sources.length === 0) return null;
      return { headers: Object.fromEntries(headers.map((h) => [h.name, h.text])), sources };
    } catch {
      return null;
    }
  })();
  return libcCache;
}

export interface OurBuild {
  ok: boolean;
  stage?: 'compile' | 'link' | 'libc';
  /** Diagnostics or link errors, formatted `file:line:col: message`. */
  errors: string[];
  link?: LinkResult;
  /** Assembly our compiler produced for the program (for the failure report). */
  asm?: string;
}

const fmtCc = (d: CcDiagnostic): string =>
  `${d.file}:${d.line}:${d.column}: ${d.severity}: ${d.message}`;

/** Compile one C file with our compiler; never throws. */
function cc(
  name: string,
  text: string,
  headers: Record<string, string>,
): { asm?: string; errors: string[] } {
  try {
    const r = compile(text, { file: name, headers });
    const errors = r.diagnostics.filter((d) => d.severity === 'error').map(fmtCc);
    if (!r.ok || errors.length)
      return { errors: errors.length ? errors : ['compile failed with no error message'] };
    return { asm: r.asm, errors: [] };
  } catch (e) {
    return {
      errors: [`compiler crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`],
    };
  }
}

const asmName = (name: string): string => name.replace(/\.c$/, '') + '.s';

/**
 * Build one corpus program with our toolchain:
 * - freestanding group: ref/crt0.s + ref/support.c + the program;
 * - libc group: the program + packages/libc sources (its crt0 when it has one).
 */
export async function buildOurs(p: CorpusProgram): Promise<OurBuild> {
  const libc = await loadLibc();
  const headers = libc?.headers ?? {};
  const files: SourceFile[] = [];
  let hasStart = false;
  const addSource = (name: string, text: string): string[] => {
    if (/\.c$/.test(name)) {
      const r = cc(name, text, headers);
      if (r.asm === undefined) return r.errors;
      files.push({ name: asmName(name), text: r.asm });
      if (/^\s*_start\s*:/m.test(r.asm)) hasStart = true;
    } else {
      files.push({ name, text });
      if (/^\s*_start\s*:/m.test(text)) hasStart = true;
    }
    return [];
  };

  const prog = cc(p.file, p.source, headers);
  if (prog.asm === undefined) return { ok: false, stage: 'compile', errors: prog.errors };
  files.push({ name: asmName(p.file), text: prog.asm });

  if (p.group === 'libc') {
    if (!libc)
      return {
        ok: false,
        stage: 'libc',
        errors: ['packages/libc has no LIBC_SOURCES yet'],
        asm: prog.asm,
      };
    for (const f of libc.sources) {
      const errs = addSource(f.name, f.text);
      if (errs.length)
        return { ok: false, stage: 'libc', errors: errs.map((e) => `libc: ${e}`), asm: prog.asm };
    }
  } else {
    const errs = addSource('support.c', readFileSync(join(REF_DIR, 'support.c'), 'utf8'));
    if (errs.length)
      return {
        ok: false,
        stage: 'compile',
        errors: errs.map((e) => `ref/support.c: ${e}`),
        asm: prog.asm,
      };
  }
  if (!hasStart)
    files.unshift({ name: 'crt0.s', text: readFileSync(join(REF_DIR, 'crt0.s'), 'utf8') });

  let link: LinkResult;
  try {
    link = build(files, { base: RAM_BASE });
  } catch (e) {
    return {
      ok: false,
      stage: 'link',
      errors: [`assembler crashed: ${e instanceof Error ? e.message : String(e)}`],
      asm: prog.asm,
    };
  }
  if (!link.ok)
    return {
      ok: false,
      stage: 'link',
      errors: link.diagnostics.map((d) => `${d.file}:${d.line}:${d.col}: ${d.message}`),
      asm: prog.asm,
    };
  return { ok: true, errors: [], link, asm: prog.asm };
}

// ---------------------------------------------------------------------------
// Differential check

export type Status = 'pass' | 'fail';
export type Stage = 'golden' | 'compile' | 'libc' | 'link' | 'run' | 'output' | 'exit';

export interface DiffResult {
  name: string;
  group: Group;
  status: Status;
  /** Where it failed. */
  stage?: Stage;
  /** One line for the table. */
  summary: string;
  /** Multi-line details for RESULTS.md. */
  details: string[];
  steps?: number;
  goldenSteps?: number;
}

/** "line 3, column 5" of the first difference plus expected/got excerpts. */
export function describeDiff(expected: string, got: string): string[] {
  let i = 0;
  while (i < expected.length && i < got.length && expected[i] === got[i]) i++;
  const line = expected.slice(0, i).split('\n').length;
  const start = expected.lastIndexOf('\n', i - 1) + 1;
  const endOf = (s: string): number => {
    const e = s.indexOf('\n', i);
    return e < 0 ? s.length : e;
  };
  const show = (s: string): string =>
    JSON.stringify(s.slice(start, Math.min(endOf(s), start + 160)));
  return [
    `first difference at output line ${line} (byte ${i}); expected ${expected.length} bytes, got ${got.length}`,
    `  expected: ${show(expected)}`,
    `  got:      ${show(got)}`,
  ];
}

export async function diffOne(p: CorpusProgram): Promise<DiffResult> {
  const base = { name: p.name, group: p.group };
  const golden = readGolden(p.name);
  if (!golden)
    return {
      ...base,
      status: 'fail',
      stage: 'golden',
      summary: 'no golden output (run pnpm cc-golden)',
      details: [],
    };
  if (golden.sourceSha256 !== sha256(p.source))
    return {
      ...base,
      status: 'fail',
      stage: 'golden',
      summary: 'golden is stale: source changed (run pnpm cc-golden)',
      details: [],
    };
  const ours = await buildOurs(p);
  if (!ours.ok || !ours.link)
    return {
      ...base,
      status: 'fail',
      stage: ours.stage ?? 'compile',
      summary: `${ours.stage ?? 'compile'} error: ${firstLine(ours.errors[0] ?? '')}`,
      details: ours.errors.slice(0, 8),
      goldenSteps: golden.steps,
    };
  let run: RunResult;
  try {
    run = runImage(ours.link.image, ours.link.entry);
  } catch (e) {
    return {
      ...base,
      status: 'fail',
      stage: 'run',
      summary: `run error: ${String(e)}`,
      details: [],
    };
  }
  const steps = { steps: run.steps, goldenSteps: golden.steps };
  if (run.end !== 'exit')
    return {
      ...base,
      ...steps,
      status: 'fail',
      stage: 'run',
      summary: run.detail,
      details: [
        run.detail,
        ...(run.uart !== golden.uart
          ? describeDiff(golden.uart, run.uart)
          : ['output matched so far']),
      ],
    };
  if (run.uart !== golden.uart)
    return {
      ...base,
      ...steps,
      status: 'fail',
      stage: 'output',
      summary: 'UART output differs',
      details: describeDiff(golden.uart, run.uart),
    };
  if (run.exitCode !== golden.exitCode)
    return {
      ...base,
      ...steps,
      status: 'fail',
      stage: 'exit',
      summary: `exit code ${run.exitCode} (expected ${golden.exitCode})`,
      details: [],
    };
  return { ...base, ...steps, status: 'pass', summary: 'ok', details: [] };
}

const firstLine = (s: string): string => s.split('\n')[0]!.slice(0, 140);

// ---------------------------------------------------------------------------
// Reports

export function table(results: readonly DiffResult[]): string {
  const rows = results.map((r) => [r.name, r.group, r.status.toUpperCase(), r.summary]);
  const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i]!.length), 7));
  const pass = results.filter((r) => r.status === 'pass').length;
  return [
    ...rows.map(
      (r) => `${r[0]!.padEnd(w[0]!)}  ${r[1]!.padEnd(w[1]!)}  ${r[2]!.padEnd(w[2]!)}  ${r[3]}`,
    ),
    `cc-diff: ${pass}/${results.length} programs match gcc`,
  ].join('\n');
}

const mdCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** RESULTS.md: deterministic (no timestamps), so it only changes when results do. */
export function resultsMarkdown(results: readonly DiffResult[]): string {
  const pass = results.filter((r) => r.status === 'pass').length;
  const byStage = new Map<string, number>();
  for (const r of results) if (r.stage) byStage.set(r.stage, (byStage.get(r.stage) ?? 0) + 1);
  const out = [
    '# cc-diff results',
    '',
    'Generated by `pnpm cc-diff` (tools/cc-diff). Do not edit by hand.',
    '',
    'Each program in `packages/cc/corpus` is compiled by our compiler (packages/cc),',
    'assembled and linked by packages/asm, and run on packages/rv32. Its UART',
    'output and exit code must equal those of the riscv gcc build of the same',
    'program on the same emulator (`packages/cc/corpus/golden/*.json`).',
    '',
    `**${pass} / ${results.length} pass.**` +
      (byStage.size
        ? ' Failures by stage: ' + [...byStage].map(([s, n]) => `${s} ${n}`).join(', ') + '.'
        : ''),
    '',
    'Stages: `compile` (our compiler reported errors), `libc` (packages/libc missing or did not compile),',
    '`link` (assembler/linker rejected the output), `run` (trap, ebreak or no exit within',
    `${STEP_LIMIT.toLocaleString('en-US')} steps), \`output\` (UART differs), \`exit\` (exit code differs),`,
    '`golden` (golden missing or stale).',
    '',
    'Build setup: freestanding programs link `tools/cc-diff/ref/crt0.s` and `ref/support.c`',
    '(memcpy/memset/memmove, compiled by our compiler); libc programs (those including',
    '`<stdio.h>`, `<stdlib.h>` or `<string.h>`) link the packages/libc sources. On RISC-V',
    'plain `char` is unsigned (gcc), and the goldens reflect that.',
    '',
    '| Program | Group | Result | Steps (ours / gcc -O2) | Detail |',
    '| --- | --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${r.name} | ${r.group} | ${r.status === 'pass' ? 'pass' : `**FAIL** (${r.stage})`} | ${
          r.steps !== undefined ? `${r.steps} / ${r.goldenSteps}` : '-'
        } | ${mdCell(r.summary)} |`,
    ),
    '',
  ];
  const failures = results.filter((r) => r.status === 'fail' && r.details.length);
  if (failures.length) {
    out.push('## Failure details', '');
    for (const r of failures) {
      out.push(`### ${r.name}`, '', '```text', ...r.details, '```', '');
    }
  }
  return out.join('\n');
}
