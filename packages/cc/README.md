# @build-a-computer/cc

The C compiler for the C levels (plan M10, CC-01 to CC-05, CC-08). It turns one
C file into RV32IM assembly that `@build-a-computer/asm` assembles and links.
It is pure TypeScript with no DOM, network or clock use, so it runs in the
browser worker and in Node tests alike.

```ts
import { compile } from '@build-a-computer/cc';
import { LIBC_HEADERS } from '@build-a-computer/libc';

const r = compile(source, { file: 'main.c', headers: LIBC_HEADERS });
// r.ok, r.asm, r.diagnostics (1-based, endColumn exclusive), r.lineMap, r.functions
```

- `lineMap[i]` is the C line (main file) of asm line `i + 1`, or 0 (headers,
  directives, data).
- `functions` is debug info for the debugger (CC-08): each function's line
  range and, for every local and parameter, its frame offset from `s0` or the
  register (`reg`, e.g. `"s1"` or `"a0"`) that holds it.
- Options: `headers` (name to text, for `#include "x.h"` and `<x.h>`),
  `charSigned` (default `false`: plain `char` is unsigned on RISC-V, like GCC),
  `defines`, and `noRegisterVariables` (keep every local in the stack frame:
  the plainest code to read and debug).

## Pipeline

`preprocess.ts` (lexer in `lexer.ts`) -> `parse.ts` (parser and type checker
in one pass, typed AST in `ast.ts`, types and ilp32 layout in `types.ts`) ->
`codegen.ts` (tree code generator, register variables, peephole, branch
relaxation). 64-bit division calls helpers from `runtime.ts`, compiled by this
compiler and appended as file-local functions when used.

## The supported language (C99 subset with GNU extensions)

- Preprocessor: `#include`, object- and function-like `#define` (`#`, `##`,
  `__VA_ARGS__`, GNU `, ##__VA_ARGS__` and `args...`), `#undef`, `#if`/
  `#ifdef`/`#ifndef`/`#elif`/`#else`/`#endif` with `defined`, `#error`,
  `#warning`, `#pragma once`, include guards, `__LINE__`, `__FILE__`,
  `__COUNTER__`. Built-in headers: `stdarg.h`, `stddef.h`, `stdbool.h`,
  `stdint.h`, `limits.h`, `iso646.h`, `stdalign.h`, `stdnoreturn.h` (libc's
  headers take precedence).
- Types: `void`, `_Bool`, `char` (unsigned by default), `signed`/`unsigned`
  `char`, `short`, `int`, `long` (32 bits), `long long` (64 bits), pointers,
  multi-dimensional arrays, structs and unions (nested, anonymous members,
  bit-fields, flexible array members, `packed`, `aligned`), enums, typedefs,
  function pointers, `const`, `volatile`, `static`, `extern`, `register`,
  `inline`, `typeof`, `_Alignof`, `_Alignas`, `_Static_assert`.
- Expressions: all C operators with C precedence, integer promotions and the
  usual arithmetic conversions, signed/unsigned division, modulo and shifts as
  RV32IM does them, pointer arithmetic, `sizeof` (never evaluates its operand),
  casts, compound literals, GNU statement expressions `({ ... })`, `?:` with
  an omitted middle operand.
- Statements: `if`, `while`, `do`, `for` (with declarations), `switch` (with
  fallthrough and GNU case ranges `case 1 ... 5:`), `break`, `continue`,
  `return`, `goto` and labels, blocks.
- Declarations: globals with constant initializers (scalars, strings,
  addresses, arrays, structs, designated initializers `.x =` and `[i] =`),
  local initializers of any kind, static locals.
- Functions: recursion, variadic functions with `<stdarg.h>`
  (`va_start`/`va_arg`/`va_end`/`va_copy`), structs passed and returned by value
  (any size), any number of arguments.
- Calling convention: RISC-V ilp32 (integer), the same as GCC with
  `-march=rv32im -mabi=ilp32`, so C, GCC-built code and hand-written assembly
  call each other: `a0`-`a7` for arguments (64-bit values in pairs, variadic
  64-bit values in aligned pairs), structs up to 8 bytes in registers and
  larger ones by reference, `a0`/`a1` for results (large structs through a
  hidden pointer in `a0`), `s0`-`s11` and `sp` preserved.
- Machine-level C for the OS levels: inline assembly
  `asm volatile("csrw mtvec, %0" :: "r"(x))` with outputs (`=r`, `+r`), inputs
  (`r`, `i`, `n`, `I`, `K`, `J`/`%z`, `m`, tied `"0"`), named operands
  `%[name]`, clobbers, `register int a0 asm("a0")` variables (the system-call
  pattern), top-level `asm("...")`; attributes `aligned(N)`,
  `section(".text.init")`, `packed`, `naked`, `interrupt` (saves every
  register and returns with `mret`; `interrupt("supervisor")` uses `sret`),
  `noreturn`, `used`, `weak`. `volatile` accesses are never removed, merged
  or reordered.
- Builtins: `__builtin_va_*`, `__builtin_offsetof`, `__builtin_expect`,
  `__builtin_constant_p`, `__builtin_types_compatible_p`,
  `__builtin_unreachable`, `__builtin_trap` (`ebreak`).

## Diagnostics

Errors and warnings carry 1-based ranges (`endColumn` exclusive) in the file
they come from (a header's errors point into the header; errors inside a macro
point at the macro's use). The compiler keeps going after an error (it skips
to the end of the statement or declaration) and stops after 50 errors.
Warnings follow gcc `-Wall` where it helps beginners: pointer/integer
conversions without a cast, incompatible pointer types, `if (x = 5)`, and
printf-family format strings checked against their arguments.

## Not supported (and the message the player sees)

- Floating point (`float`, `double`, `1.5`): "floating-point ... not
  supported".
- Variable-length arrays: "array size must be a constant expression".
- Old-style (K&R) parameter lists, computed `goto`, `_Complex`, threads,
  `setjmp`/`longjmp`, wide strings beyond simple `L"..."`.
- `long long` bit-fields; case ranges in a `switch` on a `long long`.
- Calls to undeclared functions are errors (C99), not warnings.
- A global named like a register (`gp`, `a0`, ...) is renamed `gp$` in the
  assembly, because the assembler reads those names as registers.

## Code generation

Locals live in the stack frame (addressed from `s0`) unless they are scalars
whose address is never taken: those are register variables, kept in `s1`-`s9`,
or in `a0`-`a7` in functions that make no calls (a parameter then stays where
it arrived). Expression temporaries use `t0`-`t4` (saved around calls) and the
remaining callee-saved registers; `t5`/`t6` are scratch. Functions that need no
frame get no frame pointer, and leaf functions do not save `ra`. A peephole
pass removes moves through dead temporaries and jumps to the next label, and
branches whose target may be beyond the +/-4 KiB range are rewritten as an
inverted branch over a `j`.

## Tests

- `src/*.test.ts`: lexer, preprocessor, layout, diagnostics (CC-03: 60
  malformed programs, each with one useful first error at the right place),
  inline assembly and interrupts on the emulator, the output contract.
- `src/programs.test.ts`: every program in `programs/` is built with this
  compiler and run on `@build-a-computer/rv32`; its UART output and exit code
  must equal riscv gcc's build of the same program (`programs/golden/`).
  `programs/layout.c` checks 30 struct layouts against gcc (CC-04).
  `fuzz-*.c` and `fuzzs-*.c` are generated by `scripts/fuzz.mjs` (random
  integer expressions; arrays, structs, pointers, loops and calls), free of
  undefined behavior.
- Goldens need docker (the image from `tools/cc-diff/Dockerfile`):
  `node packages/cc/scripts/gcc-golden.mjs [name...]`.
- The CC-07 corpus against gcc lives in `packages/cc/corpus` and runs with
  `pnpm cc-diff` (`tools/cc-diff`).
