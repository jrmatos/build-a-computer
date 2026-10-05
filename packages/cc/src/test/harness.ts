/**
 * Test harness: compile C, assemble and link with @build-a-computer/asm, run
 * on the @build-a-computer/rv32 machine, and report UART output and exit code.
 */
import { build } from '@build-a-computer/asm';
import { CAUSE, Machine, RAM_BASE, asm } from '@build-a-computer/rv32';
import { type CompileOptions, type CompileResult, compile } from '../index';

export const CRT0 = `
  .text
  .globl _start
_start:
  call main
  li a7, 93
  ecall
`;

/** Minimal freestanding helpers for tests (putchar to the UART, memcpy, memset). */
export const SUPPORT_C = `
typedef unsigned int size_t;
void *memcpy(void *d, const void *s, size_t n) { unsigned char *a = d; const unsigned char *b = s; while (n--) *a++ = *b++; return d; }
void *memset(void *d, int c, size_t n) { unsigned char *a = d; while (n--) *a++ = (unsigned char)c; return d; }
int putchar(int c) { *(volatile unsigned char *)0x10000000 = (unsigned char)c; return c; }
int puts(const char *s) { while (*s) putchar(*s++); putchar('\\n'); return 0; }
`;

export interface RunOutput {
  uart: string;
  exitCode: number | null;
  end: string;
  steps: number;
  asm: string;
  cc: CompileResult;
}

export class CompileFailed extends Error {}

export function compileOk(src: string, opts: CompileOptions = {}): CompileResult {
  const r = compile(src, opts);
  if (!r.ok) {
    throw new CompileFailed(r.diagnostics.map((d) => `${d.file}:${d.line}:${d.column}: ${d.severity}: ${d.message}`).join('\n'));
  }
  return r;
}

/** Compile and run `src` (with a crt0 and the support functions). */
export function run(src: string, opts: CompileOptions & { maxSteps?: number; extra?: string[]; noSupport?: boolean } = {}): RunOutput {
  const cc = compileOk(src, opts);
  const sup = compileOk(SUPPORT_C, { file: 'support.c' });
  const extra = (opts.extra ?? []).map((s, i) => ({ name: `extra${i}.s`, text: compileOk(s, { file: `extra${i}.c` }).asm }));
  const link = build(
    [
      { name: 'crt0.s', text: CRT0 },
      { name: 'main.s', text: cc.asm },
      ...(opts.noSupport ? [] : [{ name: 'support.s', text: sup.asm }]),
      ...extra,
    ],
    { base: RAM_BASE },
  );
  if (!link.ok) {
    const lines = cc.asm.split('\n');
    throw new Error(
      link.diagnostics.map((d) => `${d.file}:${d.line}: ${d.message}  [${d.file === 'main.s' ? lines[d.line - 1] : ''}]`).join('\n'),
    );
  }
  const r = runImage(link.image, link.entry, opts.maxSteps);
  return { ...r, asm: cc.asm, cc };
}

/** Run a flat image at the RAM base until exit, a trap or the step limit. */
export function runImage(image: Uint8Array, entry: number, maxSteps = 5_000_000): { uart: string; exitCode: number | null; end: string; steps: number } {
  const tx: number[] = [];
  const ramSize = 1 << 20;
  const m = new Machine({ ramSize, onUartTx: (b) => tx.push(b) });
  m.loadRom(new Uint8Array(new Uint32Array([asm('addi', 17, 0, 93), asm('ecall')]).buffer), 0x100);
  m.load(RAM_BASE, image);
  m.hart.pc = entry;
  m.hart.x[2] = (RAM_BASE + ramSize) | 0;
  m.hart.x[1] = 0x100;
  let end = 'timeout';
  let exitCode: number | null = null;
  const hart = m.hart as unknown as { takeTrap(cause: number, tval: number, epc: number): void };
  const orig = hart.takeTrap.bind(hart);
  class Stop {}
  hart.takeTrap = (cause, tval, epc) => {
    if (cause >>> 31 === 0) {
      if (cause === CAUSE.ecallM && m.hart.reg(17) === 93) {
        end = 'exit';
        exitCode = m.hart.reg(10) | 0;
        throw new Stop();
      }
      if ((m.hart.mtvec & ~3) === 0) {
        end = `trap ${cause} at pc 0x${(epc >>> 0).toString(16)} tval 0x${(tval >>> 0).toString(16)}`;
        throw new Stop();
      }
    }
    orig(cause, tval, epc);
  };
  const before = m.hart.cycles;
  try {
    m.run(maxSteps);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
  }
  let uart = '';
  for (let i = 0; i < tx.length; i += 4096) uart += String.fromCharCode(...tx.slice(i, i + 4096));
  return { uart, exitCode, end, steps: m.hart.cycles - before };
}

/** Run a program whose `main` returns a value; returns the exit code (signed). */
export function exitOf(src: string, opts: CompileOptions = {}): number {
  const r = run(src, opts);
  if (r.end !== 'exit') throw new Error(`program did not exit: ${r.end}\n${r.uart}`);
  return r.exitCode ?? -999;
}
