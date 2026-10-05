# The Phase 5 RV32I datapath

Phase 5 (Track 1, "RISC-V CPU") has the player build a real RV32I processor
from blocks. This document is the spec the levels teach and test. The
levels live in `packages/content/src/phase5/`, the reference solutions in
`packages/content/solutions/phase5/`, and the block models in
`packages/sim-logic/src/blocks/rv.ts`. Toy-8 ([toy8.md](toy8.md)) came
first, and this machine follows the same pattern.

## The machine

| Item | Phase 5 machine |
| --- | --- |
| ISA | RV32I base integer set, without `fence`, `ecall` or CSRs |
| Registers | x0..x31, 32 bits each; x0 always reads 0 |
| Program memory | ROM labelled `ROM`: 256 words of 32 bits (`addrWidth 8`, `width 32`). Word address = PC bits 9..2 |
| Data memory | A separate RAM of 1024 words of 32 bits (`addrWidth 10`, `width 32`) behind the load/store unit: byte addresses 0x000..0xFFF |
| Reset | Power on clears every register, the PC (0) and the RAM |
| Halt | `ebreak` (0x00100073) |
| Visible state | lamp `A0` (x10) and lamp `HALT` |

It is a Harvard machine: code and data are separate memories. Programs are
linked at address 0 and must fit in 0x400 bytes. By convention they keep their
data at 0x400..0xFFF (the data RAM also answers below 0x400, but the golden
model does not, so test programs never use those addresses). The stack pointer
starts at 0x1000 and grows down. Data addresses wrap modulo 4 KiB, since the
load/store unit only passes address bits 11..2 to the RAM.

### Halt convention

`ebreak` is the halt instruction. While the instruction at the PC is
`ebreak`:

- the `HALT` lamp is on (`HALT = opcode SYSTEM AND inst[20]`; ecall and CSR
  instructions are not part of Phase 5);
- the next PC is the PC itself, and nothing is written (no register, no
  memory).

So the CPU freezes on its `ebreak`. The `program` checker stops as soon as
`HALT` reads 1, then compares the lamps. Running all-zero ROM words (0x00000000,
an illegal instruction) has no defined behavior; test programs never get there.

In the optional pipeline level, `HALT` lights when `ebreak` reaches
write-back, so every older instruction has finished.

### The A0 lamp

The `regfile` block has two read ports, both used by the datapath. To show a0,
the player adds a 32-bit register next to the register file that copies every
write to x10: `d = wd`, `load = we AND (rd = 10)`. It holds the same value as
x10. The test-only debug boards use the same trick for x1..x31.

## Blocks

Each block is built from earlier parts in its own level, then unlocked as a
palette block for the levels after it. `rvalu` is given in the ALU-control
level, because the player built a 32-bit ALU in Phase 2. Pins follow
`pinsOf` in `packages/sim-logic/src/parts-spec.ts`.

| Block | Inputs | Outputs | Behavior |
| --- | --- | --- | --- |
| `regfile` | rs1, rs2, rd (5), wd (32), we, clk | r1, r2 (32) | r1 = x[rs1], r2 = x[rs2], read asynchronously; on a rising edge with we, x[rd] ← wd; x0 is always 0 |
| `immgen` | inst (32) | imm (32) | Sign-extended immediate in the instruction's format (table below); 0 for opcodes without one |
| `rvalu` | a, b (32), op (4) | out (32), zero | op = {funct7 bit 5, funct3} (table below); zero = (out = 0) |
| `branchcmp` | a, b (32), funct3 (3) | take | The branch condition for funct3; 2 and 3 never take |
| `lsu` | addr, wdata (32), funct3, load, store, rdata (32) | maddr (10), mwdata (32), mwe, result (32), misaligned | Sits between the CPU and a word RAM: see "Load/store unit" |

### Immediate formats

Bit 31 of the instruction is always the sign. The immediate generator picks
the format from the opcode (inst[6:0]). Every RV32I opcode ends in `11`, so
bits 6..2 are enough, and a 5-bit decoder gives one line per opcode.

| Format | Opcodes (decoder line) | imm |
| --- | --- | --- |
| I | 0x03 load (0), 0x13 ALU-imm (4), 0x67 jalr (25), 0x73 system (28) | sext(inst[31:20]) |
| S | 0x23 store (8) | sext(inst[31:25] : inst[11:7]) |
| B | 0x63 branch (24) | sext(inst[31] : inst[7] : inst[30:25] : inst[11:8] : 0) |
| U | 0x37 lui (13), 0x17 auipc (5) | inst[31:12] : 12 zeros |
| J | 0x6f jal (27) | sext(inst[31] : inst[19:12] : inst[20] : inst[30:21] : 0) |
| none | 0x33 ALU (12) | 0 |

### ALU operations and ALU control

| op | operation | op | operation |
| --- | --- | --- | --- |
| 0 | add | 8 | sub |
| 1 | sll (b[4:0]) | 5 | srl |
| 2 | slt (signed) | 13 | sra |
| 3 | sltu | 4 | xor |
| 6 | or | 7 | and |

ALU control:

- OP (0x33): `op = {inst[30], funct3}`.
- OP-IMM (0x13): `op = {inst[30] AND funct3 = 5, funct3}`. Bit 30 is an
  immediate bit everywhere except `srli`/`srai`, so `addi x1, x1, -1` must
  still add.
- Everything else: `op = 0` (add). Loads and stores add to form the address,
  and auipc adds the immediate to the PC.

### Branch comparator

| funct3 | branch | take when |
| --- | --- | --- |
| 0 / 1 | beq / bne | a = b / a ≠ b |
| 4 / 5 | blt / bge | a < b / a ≥ b, signed |
| 6 / 7 | bltu / bgeu | a < b / a ≥ b, unsigned |
| 2, 3 | (none) | never |

### Load/store unit

The RAM stores 32-bit words. `maddr = addr[11:2]`, and `addr[1:0]` picks the
byte inside the word (little-endian: byte 0 is bits 7..0).

| funct3 | load (`load` = 1) | store (`store` = 1) |
| --- | --- | --- |
| 0 | lb: byte, sign-extended | sb |
| 1 | lh: half, sign-extended | sh |
| 2 | lw | sw |
| 4 | lbu: byte, zero-extended | (none) |
| 5 | lhu: half, zero-extended | (none) |

- `result` is the loaded value. It is 0 when the access is misaligned or
  funct3 is not a load.
- `mwdata` is `rdata` with the stored byte, half or word merged in (a
  read-modify-write), and `mwe = store AND valid store funct3 AND aligned`.
- `misaligned` is on when a half is at an odd address or a word is not on a
  4-byte boundary, and only during a load or a store. Phase 5 has no traps, so
  this is a status output only: a misaligned store writes nothing. The test
  programs never misalign.

## The single-cycle datapath

```
          +-----+    +-----+ inst  +-------+ imm
 +------> | PC  |--->| ROM |------>|immgen |------------------------+
 |        +-----+    +-----+   |   +-------+                        |
 |           |                 |  rs1,rs2,rd   +---------+  r1      v
 |           |                 +-------------->| regfile |---+--> [a-mux: r1 / PC (auipc) / 0 (lui)]
 |           |                 |               |         |---+--> [b-mux: imm / r2 (0x33)]
 |           |                 |  ALU control  +---------+   |       |
 |           |                 +-------------------------> rvalu <---+
 |           |                                               | out
 |           |        branchcmp(r1, r2, funct3) -> take      v
 |           |                                       lsu(addr = out, wdata = r2) <-> RAM
 |           |                                               |
 |           +--> PC + 4 ------+--> wd = load ? lsu.result : jal/jalr ? PC + 4 : ALU out
 |           +--> PC + imm --+ |
 |                           v v
 +---- next PC: ebreak ? PC : jalr ? (ALU out & ~1) : (jal OR (branch AND take)) ? PC + imm : PC + 4
```

Control signals come from the decoder lines on inst[6:2]:

| Signal | Value |
| --- | --- |
| regfile we | ALU OR ALU-imm OR load OR lui OR auipc OR jal OR jalr |
| ALU a | auipc ? PC : lui ? 0 : r1 |
| ALU b | ALU (0x33) ? r2 : imm |
| lsu load / store | load line / store line |
| wd | load ? lsu result : (jal OR jalr) ? PC + 4 : ALU out |
| next PC | ebreak ? PC : jalr ? ALU out with bit 0 cleared : (jal OR (branch AND take)) ? PC + imm : PC + 4 |
| HALT | system AND inst[20] |

The reference board (`rvSingleCycle` in
`packages/content/solutions/phase5/rv-cpu.ts`) has 60 parts and 137 wires: the 5
blocks, RAM, ROM, 2 registers (PC and the A0 shadow), 2 adders, 9 muxes, 2
decoders, 7 constants, splitters/joiners and gates.

## The five-stage pipeline (optional level)

IF, ID, EX, MEM and WB, with pipeline registers between them. The reference
(`rvPipeline`, 199 parts) carries each instruction word down the pipeline and
decodes it again in every stage. A bubble is `addi x0, x0, 0` (0x00000013).

| Hazard | Handling |
| --- | --- |
| A result is needed one or two instructions later | Forward into EX from EX/MEM (the ALU result or PC + 4), else from MEM/WB (the write-back value) |
| A register is written in WB and read in ID in the same cycle | Bypass around the register file in ID |
| A load result is needed by the next instruction | Stall one cycle: hold PC and IF/ID, and put a bubble into ID/EX |
| A taken branch, jal or jalr in EX | Load the target into the PC, and put bubbles into IF/ID and ID/EX |
| ebreak in ID | Stop fetching (hold PC and IF/ID) and let it flow on; HALT = ebreak in WB |

The simulator does not model gate delays, so the level checks only that
results stay correct within a cycle budget of 3 × the instruction count + 16.

## Levels

| Order | Id | Builds | Test |
| --- | --- | --- | --- |
| 1 | `rv-register-file` | regfile from registers, a decoder and mux trees | sequence (random power on) |
| 2 | `immediate-generator` | immgen from splitters, joiners and muxes | truth table, every format |
| 3 | `alu-control` | ALU control around the given `rvalu` | truth table, OP and OP-IMM |
| 4 | `branch-comparator` | branchcmp | truth table, every funct3 |
| 5 | `load-store-unit` | lsu | truth table, aligned and misaligned |
| 6 | `next-pc` | the next-PC logic and HALT | truth table |
| 7 | `single-cycle-datapath` | the whole CPU | 6 programs, one per instruction group |
| 8 | `running-programs` | (no new hardware) | 6 programs: sum loop, Fibonacci, memcpy with lb/sb, recursive fib, shift-add multiply, bubble sort |
| 9 | `rv-pipeline` (optional) | the 5-stage pipeline | 7 programs, including a hazard program |

The truth-table rows of levels 2 to 6 are computed by small pure functions in
`src/phase5/rv.ts`. `phase5.test.ts` checks those functions against the sim-logic
block models and against the `packages/rv32` hart.

## Test programs and the golden model

The programs are RV32I assembly in `src/phase5/programs.ts`. Each one ends in
`ebreak` and leaves its answer in a0. The content package may depend only on
the schema at run time, so the assembled bytes and expected results are
generated into `src/phase5/programs.data.ts`, using `@build-a-computer/asm`
(`build(source, { base: 0 })`) and the `@build-a-computer/rv32` hart, which is
the golden model. The hart is set up on the Phase 5 memory map
(`solutions/phase5/golden.ts`): read-only code at 0..0x3FF, data at
0x400..0xFFF, run until the PC reaches `ebreak`, with any trap treated as an
error.

A test checks that the generated file is up to date. To regenerate it:

```
cd packages/content && UPDATE_RV_PROGRAMS=1 npx vitest run src/phase5
```

Every `program` test uses `wordBytes: 4`: program bytes are packed
little-endian into 32-bit ROM words. The test expects `A0` = x10 and `HALT` = 1,
with `maxCycles` = instructions + 16 on the single-cycle levels.

The content tests also run every program on the single-cycle reference board
and compare the PC and x1..x31 with the hart after every cycle. They run every
program on the pipelined board and compare all registers at HALT.
