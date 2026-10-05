# Code levels: machine setup and test semantics

How a `mode: 'code'` level's program (assembly or C) runs, for level authors.
The test checker (`packages/rv-check`) and the debugger (`packages/worker`,
`RvApi`) build the program with the same `buildProgram(source, level)` and the
machine with the same `createMachine`, so what the debugger shows is what the
tests run.

## Build: assembly levels (`code.language: 'rv32-asm'`)

- The player's file is `main.s`. The level's `code.library` files are built
  after it, in order: `.c` files are compiled (see C levels), `.h` files are
  skipped, anything else is assembled. Everything is linked into one flat
  image at the RAM base `0x8000_0000` (sections: text, rodata, data, bss).
- Entry point: `_start` if `main.s` or a library defines it (global or local in
  `main.s`), else the first instruction of `.text` (`0x8000_0000`).
- Assembly or link errors fail every test with the first 5 errors as
  `file:line:col: message`.

## Build: C levels (`code.language: 'c'`)

- The player's file is `main.c`, compiled by `@build-a-computer/cc` to
  assembly. Level library files: `.h` files are headers, `.c` files are
  compiled, `.s` files (and any other name) are assembled.
- Headers on the include path (`#include <x.h>` and `"x.h"`): libc's headers
  (`stdio.h`, `stdlib.h`, `string.h`, `ctype.h`, `assert.h`, `limits.h`, ...;
  see `packages/libc`) when libc is linked, then the level's `.h` files (a
  level header with the same name as a libc header wins). Without libc only
  the level's headers exist.
- libc (`code.libc`, default true for C levels): crt0 + the libc sources are
  linked in. Link order: libc's `crt0.s` first (so `_start` is at
  `0x8000_0000`), then `main.c`, then the library files in order, then the
  rest of libc, ending with `end.s` (`_end`: the heap starts after every
  global). `code.libc: false` links no libc at all (OS levels bring their own
  runtime); a level `.s` may define `_start`.
- Entry and exit: libc's `_start` zeroes .bss, calls `main(0, NULL)` and exits
  with its return value (`ecall` with `a7 = 93`). Without libc the entry is
  `_start` when a library defines it, else `main`; the initial `ra` is the
  exit stub, so returning from `main` exits with its return value either way.
- Diagnostics are in the player's terms: compiler errors on `main.c` lines; a
  link error such as calling a declared-but-undefined function is reported at
  the C line of the call; a missing `main` says so; defining a name libc also
  defines points at the player's definition. An assembler error in generated
  code is reported at the C line it came from as an "Internal compiler error
  (not your fault)", unless that C line holds inline `asm`. Errors inside
  libc itself are labelled as libc errors.
- Line mapping: the compiler returns, for each assembly line it emits, the C
  line it came from (`lineMap`, 0 = none). `Program.locate(pc)` goes
  pc → assembly line (linker source map) → C line, so trap messages, the
  debugger's current line, breakpoints and step-line all use C lines. Code
  with no C line (prologues, epilogues) has no line. Symbols for the debugger
  are function and global names; compiler-internal labels (`.L…`) are hidden.
- Compile or link errors fail every test with "The program does not compile"
  and the first 5 errors.

## Machine at the first instruction

- RV32IMA + Zicsr, machine mode, full memory map (docs/plan.md "Machine memory
  map"). `code.devices` only picks the UI panels.
- RAM: `code.ramSize` bytes (default 1 MiB), zeroed, image loaded, bss zero.
- `pc` = entry.
- `sp` = `0x8000_0000 + ramSize`, one past the last RAM byte (16-byte aligned;
  the stack grows down from there). Example: 1 MiB RAM gives `sp = 0x8010_0000`.
- `ra` = `0x0000_0100`, a boot-ROM stub that runs `li a7, 93; ecall`. So `ret`
  from `_start` exits with `a0` as the exit code, like returning from C `main`.
- Every other register is 0. No trap handler is installed (`mtvec = 0`).
- Then the test's `setup.regs` (ABI names like `a0`, `fp`, or `xN`) and
  `setup.memory` pokes (hex bytes at an address) are applied.
- Disk: a level whose `code.devices` lists `disk` gets a blank 1 MiB disk
  (2,048 sectors of 512 bytes); the test's `setup.disk` entries write hex
  bytes starting at a sector (they may run on into the following sectors).
  Data past the end of the disk, or `setup.disk` on a level without the
  `disk` device, fails the test with a setup message. Other levels have no
  disk (0 sectors).
- `input` is queued in the UART receiver and pressed into the keyboard device
  (one key code per byte), before the first instruction.

## How a program ends

| Event | Result |
| --- | --- |
| `ebreak` (any mode, handler or not) | Stops. No exit code. |
| Return from C `main` | Exit with its return value (through libc's crt0, or the exit stub without libc). |
| `ecall` with `a7 = 93` from M-mode | Exit; exit code = `a0` (unsigned 32-bit). Works even with a trap handler installed. |
| `ecall` with `a7 = 93` from S/U mode | Exit, unless a handler would receive it (then the handler runs). |
| Any other exception with no handler (`mtvec`/`stvec` = 0) | Stops with a plain-English trap message (illegal instruction at line N, misaligned access, access fault with the address, ...). Fails the test. |
| Exceptions with a handler installed, interrupts | Taken normally. |
| `wfi` with nothing that can wake it | Fails: "waiting for an interrupt that never comes" (E-CPU-11). |
| `maxSteps` steps (default 5,000,000) | Fails: "never stopped ... add an exit or ebreak" (E-SIM-10). |
| Wall-clock budget (worker: 10 s per test) | Fails: "ran out of time". |

Running off the end of the code (into zeroed RAM) is reported as such, with
the same "add an exit" hint. In C levels the hints say to return from `main`
(or call `exit`), and messages cite `main.c` lines (`line 12`) or the library
file (`lib.c line 3`); code without a source line is cited by address and
function.

The stop rules come from a public hook on the hart: `Hart.onTrap(cause, tval,
epc)` returns `'stop'` to stop instead of taking the trap (`run` then returns
reason `'stopped'`, pc at the trapping instruction).

## Comparison (one case per test)

Only fields present in `expect` are checked. The test passes when the program
ended with `ebreak` or exit and every check matches.

- `regs`: each named register, unsigned 32-bit. Shown as decimal strings in
  `actual`; messages show the signed value too (`4294967295 (-1)`).
- `exitCode`: the program must exit through `ecall a7 = 93` (or `ret` from
  `_start`) with this `a0`; stopping at `ebreak` fails.
- `memory`: hex bytes at an address must match exactly (RAM, ROM or
  framebuffer pixels).
- `uart`: the exact UART output (UTF-8). The message shows expected vs got
  around the first difference.
- `framebufferSha256`: SHA-256 (hex) of the 64,000 pixel bytes at `0x2000_0000`.

The case's `summary` says how many instructions ran and how the program ended,
e.g. `Ran 37 instructions; exited with code 55.`

## Debugger (RvApi) notes

- `rvLoad` builds with `buildProgram` and also applies the first `riscv`
  test's `setup` (registers, memory and disk, not `input`), so debugging
  starts where test 1 starts. Its diagnostics are the program's (C
  diagnostics on `main.c` for C levels); its symbols are labels (function
  names for C).
- "Debug this test": `rvLoad(source, level, { test, stopAtMain })` loads
  `level.tests[test]`'s setup, `input` (UART and keyboard) and disk instead;
  `stopAtMain` (C levels) runs crt0 and pauses at `main`. Reset keeps both.
  Each snapshot then has `test` (`RvTestView`): every expectation with its
  current value (`riscvChecks`: registers, exit code, memory bytes, UART text
  with the first difference). When the program exits, traps, reaches
  `ebreak`, waits forever or passes the test's `maxSteps` (it pauses there
  once), `test.verdict` is `judgeRiscv` on the machine (the checker's own
  verdict) and `test.lineHits` says how often each line of the player's file
  ran (replayed; runs up to 1,000,000 steps).
- Case results from `runRiscvTest` carry `checks` (the same `RvCheck` list,
  UART text cut to 400 characters around the first difference) for the test
  strip.
- `ebreak` pauses (reason `ebreak`); run or step continues after it. Exit and
  unhandled traps end the run until `rvReset`.
- `wfi` with nothing pending stops with reason `wfi`; if it was running,
  `rvInput` resumes it.
- Breakpoints are lines of the player's file (`main.s` or `main.c`). Lines
  without code (comments, labels, blank lines) apply to the next line with
  code; a line breaks at the start of each contiguous run of its
  instructions. `rvStepLine` steps into calls and stops at the next different
  line of the player's file (C lines in C levels; library and libc code is
  run through). `RvState.line`/`file` are C positions in C levels and absent
  when pc has no source line.
- `rvFramebuffer` returns the palette as `0xRRGGBBAA` (alpha `0xff`), and
  `null` unless `code.devices` includes `framebuffer`.
