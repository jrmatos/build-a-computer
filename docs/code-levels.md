# Code levels: machine setup and test semantics

How a `mode: 'code'` level's assembly runs, for level authors. The test checker
(`packages/rv-check`) and the debugger (`packages/worker`, `RvApi`) build the
machine with the same code, so what the debugger shows is what the tests run.

## Build

- The player's file is `main.s`. The level's `code.library` files are assembled
  after it, in order, and everything is linked into one flat image at the RAM
  base `0x8000_0000` (sections: text, rodata, data, bss).
- Entry point: `_start` if `main.s` or a library defines it (global or local in
  `main.s`), else the first instruction of `.text` (`0x8000_0000`).
- Assembly or link errors fail every test with the first 5 errors as
  `file:line:col: message`.

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
- `input` is queued in the UART receiver and pressed into the keyboard device
  (one key code per byte), before the first instruction.

## How a program ends

| Event | Result |
| --- | --- |
| `ebreak` (any mode, handler or not) | Stops. No exit code. |
| `ecall` with `a7 = 93` from M-mode | Exit; exit code = `a0` (unsigned 32-bit). Works even with a trap handler installed. |
| `ecall` with `a7 = 93` from S/U mode | Exit, unless a handler would receive it (then the handler runs). |
| Any other exception with no handler (`mtvec`/`stvec` = 0) | Stops with a plain-English trap message (illegal instruction at line N, misaligned access, access fault with the address, ...). Fails the test. |
| Exceptions with a handler installed, interrupts | Taken normally. |
| `wfi` with nothing that can wake it | Fails: "waiting for an interrupt that never comes" (E-CPU-11). |
| `maxSteps` steps (default 5,000,000) | Fails: "never stopped ... add an exit or ebreak" (E-SIM-10). |
| Wall-clock budget (worker: 10 s per test) | Fails: "ran out of time". |

Running off the end of the code (into zeroed RAM) is reported as such, with
the same "add an exit" hint.

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

- `rvLoad` also applies the first `riscv` test's `setup` (registers and memory,
  not `input`), so debugging starts where test 1 starts.
- `ebreak` pauses (reason `ebreak`); run or step continues after it. Exit and
  unhandled traps end the run until `rvReset`.
- `wfi` with nothing pending stops with reason `wfi`; if it was running,
  `rvInput` resumes it.
- Breakpoints on lines without code (comments, labels) apply to the next line
  with code. `rvStepLine` steps into calls and stops at the next different
  `main.s` line.
- `rvFramebuffer` returns the palette as `0xRRGGBBAA` (alpha `0xff`), and
  `null` unless `code.devices` includes `framebuffer`.
