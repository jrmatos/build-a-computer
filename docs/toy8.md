# Toy-8: the Phase 4 teaching CPU (TOY-01)

> **Status: DRAFT, owner approval needed** (human review gate: curriculum).
> Reference model, assembler and disassembler: `packages/content/src/toy8.ts`.
> Reference CPU board built from blocks: `packages/content/solutions/phase3-4/toy8-cpu.ts`.

Toy-8 is small on purpose. Every part of it maps to one block the player
unlocked in Phases 2 and 3, and the instruction encoding is laid out so the
decoder is a 3-bit `decoder` block plus a few AND gates.

## Machine

| Item         | Value                                                                                 |
| ------------ | ------------------------------------------------------------------------------------- |
| Data width   | 8 bits                                                                                |
| Registers    | R0, R1, R2, R3 (8 bits each, general purpose, no special register)                    |
| Flags        | Z (zero), N (negative = bit 7), C (carry / not borrow), set by ALU instructions only   |
| Program      | ROM labelled `ROM`, props `addrWidth: 8, width: 8`: 256 bytes (Harvard architecture)  |
| Data memory  | RAM, `addrWidth: 8, width: 8`: 256 bytes, separate from the program                    |
| PC           | 8 bits (a `counter` block), wraps from 0xFF to 0x00                                   |
| Outputs      | 8-bit lamp labelled `OUT` (the OUT register), 1-bit lamp labelled `HALT`              |
| Clock        | one global clock; every clocked block samples on the rising edge                       |

## Encoding

Every instruction is **2 bytes**: an instruction byte, then an operand byte
(`imm`). Instructions that do not use `imm` still take 2 bytes; the assembler
writes 0 there.

```
byte 0:  7   6 5 4   3 2   1 0        byte 1:  7 ... 0
         A   c c c   d d   s s                  imm (8 bits)
```

- `A` (bit 7): 1 = ALU instruction, 0 = system instruction.
- `ccc` (bits 6..4): ALU operation when `A = 1` (wired straight to the ALU `op`
  pin, `ALU_OPS` order); system operation when `A = 0` (into a 3-bit decoder).
- `dd` (bits 3..2): `rd`, the destination register (also read as operand a).
- `ss` (bits 1..0): `rs`, the source register (operand b); for branches, the
  condition `cc`.

| Byte 0 | Mnemonic        | Effect                                           | Flags |
| ------ | --------------- | ------------------------------------------------ | ----- |
| `0x0_` | `HALT`          | stop; the HALT lamp turns on and stays on        | -     |
| `0x1_` | `LDI rd, imm`   | rd ← imm                                         | -     |
| `0x2_` | `MOV rd, rs`    | rd ← rs                                          | -     |
| `0x3_` | `LD rd, [rs]`   | rd ← mem[rs]                                     | -     |
| `0x4_` | `ST rd, [rs]`   | mem[rs] ← rd                                     | -     |
| `0x5_` | `OUT rd`        | OUT ← rd                                         | -     |
| `0x6_` | `JMP imm`       | pc ← imm                                         | -     |
| `0x7_` | `Jcc imm`       | if cc then pc ← imm; cc = `ss`: 0 `JZ` (Z), 1 `JNZ` (not Z), 2 `JC` (C), 3 `JN` (N) | - |
| `0x8_` | `ADD rd, rs`    | rd ← rd + rs                                     | Z N C |
| `0x9_` | `SUB rd, rs`    | rd ← rd - rs; C = 1 when rd ≥ rs (unsigned)      | Z N C |
| `0xA_` | `AND rd, rs`    | rd ← rd & rs                                     | Z N, C = 0 |
| `0xB_` | `OR rd, rs`     | rd ← rd \| rs                                    | Z N, C = 0 |
| `0xC_` | `XOR rd, rs`    | rd ← rd ^ rs                                     | Z N, C = 0 |
| `0xD_` | `NOT rd`        | rd ← ~rd (rs ignored, encoded 0)                 | Z N, C = 0 |
| `0xE_` | `SHL rd, rs`    | rd ← rd << (rs & 7)                              | Z N, C = 0 |
| `0xF_` | `SHR rd, rs`    | rd ← rd >> (rs & 7), logical                     | Z N, C = 0 |

Sixteen opcodes (the upper nibble). Byte `0x00` is `HALT`, so an empty ROM
stops at once instead of running garbage. ALU results and flags follow the
`alu` block exactly (`ALU_OPS` and the conventions in
`packages/sim-logic/src/blocks/references.ts`).

### Assembly syntax

```
; comment (also #)
loop:   ADD R0, R1        ; label definitions end with ':'
        JNZ loop          ; jump targets: label or number
        LDI R2, 0x2A      ; numbers: 42, 0x2A, 0b101010, 'A', -1 (= 255)
        .byte 1, 2, 3     ; raw bytes (also DB)
```

Mnemonics and register names are case-insensitive. Labels are byte addresses.

## Timing: 2 cycles per instruction

A one-bit phase flip-flop `P` toggles every cycle (`d = NOT q`).

| Cycle            | What happens on the rising edge that ends it                                        |
| ---------------- | ------------------------------------------------------------------------------------ |
| Fetch (`P = 0`)  | IR ← ROM[PC]; PC ← PC + 1                                                            |
| Execute (`P = 1`)| `imm` = ROM[PC] (read combinationally); write the result; PC ← jump ? imm : PC + 1 |

So an instruction takes exactly 2 full clock cycles (4 ticks), and a
program of `n` executed instructions that ends with `HALT` raises the HALT
lamp after `2n` cycles. Register writes, flag writes, memory writes, OUT and
HALT all happen on the rising edge that ends the execute cycle.

After HALT executes, every load is gated off (`run = NOT halted`): PC,
registers, memory and OUT are frozen. The `program` checker stops at HALT.

## Reset

There is no reset pin. **Power on is reset**: CPU levels use
`power: 'zero'`, so PC = 0, P = 0 (fetch), IR = 0, registers, flags, OUT and
data memory are 0, and HALT is off. The ROM keeps its contents across a power
cycle (E-SIM-08). Earlier datapath levels (register file, ALU, memory) use
`power: 'random'` and their tests only read state they wrote first (E-SIM-07).

## The machine as blocks

| Block                  | Wiring                                                                 |
| ---------------------- | ---------------------------------------------------------------------- |
| `counter` PC (8)       | d = ROM.q, load = exec AND jumpTaken, en = run, q → ROM.addr           |
| `register` IR (8)      | d = ROM.q, load = fetch                                                |
| `dff` P                | d = NOT P; fetch = run AND NOT P; exec = run AND P                     |
| `splitter` + `joiner`s | IR → bits; rs = bits 1..0, rd = bits 3..2, op = bits 6..4, A = bit 7   |
| `decoder` (3 bits)     | op → HALT, LDI, MOV, LD, ST, OUT, JMP, Jcc (each AND NOT A)            |
| 4 × `register` (8)     | R0..R3, d = write-back; load = exec AND writes AND (2-bit decoder of rd) |
| 2 × 4:1 mux trees      | port a = R[rd], port b = R[rs] (three 2:1 `mux` blocks each)           |
| `alu` (8)              | a = R[rd], b = R[rs], op = IR bits 6..4                                |
| 3 × `register` (1)     | Z, N, C from the ALU; load = exec AND A                                |
| `ram` (8 × 256)        | addr = R[rs], d = R[rd], we = exec AND ST                              |
| write-back muxes       | bit 4 ? mem : R[rs] → bit 5 ? that : imm → A ? ALU : that              |
| `register` OUT (8)     | d = R[rd], load = exec AND OUT                                         |
| `register` halted (1)  | d = 1, load = exec AND HALT; drives the HALT lamp; run = NOT halted    |
| condition mux (4:1)    | cc → Z, NOT Z, C, N; jumpTaken = JMP OR (Jcc AND condition)            |

Register writes happen for ALU instructions, LDI, MOV and LD
(`writes = A OR LDI OR MOV OR LD`).

## Example: multiply by repeated addition

```
        LDI R0, 0       ; product
        LDI R1, 6       ; a
        LDI R2, 7       ; b, counts down
        LDI R3, 1
        OR  R2, R2      ; Z = (b == 0)
        JZ  done
loop:   ADD R0, R1
        SUB R2, R3
        JNZ loop
done:   OUT R0          ; 42
        HALT
```

## Assumptions to confirm (open questions)

- Splitter output `o0` and joiner input `i0` are the least significant chunk.
- The `program` checker writes the program into the ROM's `data` prop as
  whitespace-separated two-digit hex bytes and counts full clock cycles from
  power on, checking HALT after each cycle.
