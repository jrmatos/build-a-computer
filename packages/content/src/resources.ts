import type { Resource } from '@build-a-computer/schema';

/**
 * Further-reading links per level, merged into LEVELS by `index.ts`
 * (a level's own `resources` are used only when it has no entry here).
 *
 * Resource policy (docs/plan.md, AGENTS.md): every URL below was fetched by an
 * agent and `verifiedTitle` is the exact page <title> (YouTube: oEmbed title;
 * PDF: the chapter heading) seen at `verifiedAt`. Never add a URL you have not
 * fetched. 2 to 4 per level, the first tagged 'start-here'. `differsNote` marks
 * a different ISA, machine or notation (E-RES-03). The weekly link check
 * (tools/link-check, CNT-02) opens an issue when one breaks; it never swaps links.
 */

type Kind = 'video' | 'article' | 'book' | 'spec' | 'course';

const link = (r: Omit<Resource, 'tags' | 'lang'> & { kind: Kind; lang?: string }): Resource => {
  const { kind, lang = 'en', ...rest } = r;
  return { ...rest, tags: [kind], lang };
};

/** The level's first stop: same resource, plus the 'start-here' tag. */
const start = (r: Resource): Resource => ({ ...r, tags: ['start-here', ...r.tags] });

const CC3 = link({
  url: 'https://www.youtube.com/watch?v=gI-qXk7XojA',
  title: 'Boolean Logic & Logic Gates (Crash Course Computer Science #3)',
  kind: 'video',
  verifiedTitle: 'Boolean Logic & Logic Gates: Crash Course Computer Science #3',
  verifiedAt: '2026-10-05T16:26:23Z',
});

const CC2 = link({
  url: 'https://www.youtube.com/watch?v=LN0ucKNX0hc',
  title: 'Electronic Computing (Crash Course Computer Science #2)',
  kind: 'video',
  verifiedTitle: 'Electronic Computing: Crash Course Computer Science #2',
  verifiedAt: '2026-10-05T16:26:22Z',
});

const LAGUE1 = link({
  url: 'https://www.youtube.com/watch?v=QZwneRb-zqA',
  title: 'Exploring How Computers Work (Sebastian Lague)',
  kind: 'video',
  verifiedTitle: 'Exploring How Computers Work',
  verifiedAt: '2026-10-05T16:26:32Z',
});

const WP_NAND = link({
  url: 'https://en.wikipedia.org/wiki/NAND_logic',
  title: 'NAND logic (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'NAND logic - Wikipedia',
  verifiedAt: '2026-10-05T16:27:04Z',
});

const N2T1 = link({
  url: 'https://www.nand2tetris.org/project01',
  title: 'Nand2Tetris Project 1: Boolean Logic',
  kind: 'course',
  differsNote: 'Builds the Hack computer in its own HDL, not with this game\'s parts.',
  verifiedTitle: 'Project 01 | nand2tetris',
  verifiedAt: '2026-10-05T16:26:39Z',
});

const WP_GATE = link({
  url: 'https://en.wikipedia.org/wiki/Logic_gate',
  title: 'Logic gate (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Logic gate - Wikipedia',
  verifiedAt: '2026-10-05T16:27:04Z',
});

const WP_COMPLETE = link({
  url: 'https://en.wikipedia.org/wiki/Functional_completeness',
  title: 'Functional completeness (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Functional completeness - Wikipedia',
  verifiedAt: '2026-10-05T16:27:03Z',
});

const WP_MUX = link({
  url: 'https://en.wikipedia.org/wiki/Multiplexer',
  title: 'Multiplexer (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Multiplexer - Wikipedia',
  verifiedAt: '2026-10-05T16:27:04Z',
});

const WP_DECODER = link({
  url: 'https://en.wikipedia.org/wiki/Binary_decoder',
  title: 'Binary decoder (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Binary decoder - Wikipedia',
  verifiedAt: '2026-10-05T16:27:03Z',
});

const BE_HEX = link({
  url: 'https://www.youtube.com/watch?v=7zffjsXqATg',
  title: 'Designing a 7-segment hex decoder (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Designing a 7-segment hex decoder',
  verifiedAt: '2026-10-05T16:26:16Z',
});

const CC4 = link({
  url: 'https://www.youtube.com/watch?v=1GSjbWt0c9M',
  title: 'Representing Numbers and Letters with Binary (Crash Course Computer Science #4)',
  kind: 'video',
  verifiedTitle: 'Representing Numbers and Letters with Binary: Crash Course Computer Science #4',
  verifiedAt: '2026-10-05T16:26:23Z',
});

const WP_BINARY = link({
  url: 'https://en.wikipedia.org/wiki/Binary_number',
  title: 'Binary number (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Binary number - Wikipedia',
  verifiedAt: '2026-10-05T16:27:02Z',
});

const CC5 = link({
  url: 'https://www.youtube.com/watch?v=1I5ZMmrOfnA',
  title: 'How Computers Calculate: the ALU (Crash Course Computer Science #5)',
  kind: 'video',
  verifiedTitle: 'How Computers Calculate - the ALU: Crash Course Computer Science #5',
  verifiedAt: '2026-10-05T16:26:24Z',
});

const WP_ADDER = link({
  url: 'https://en.wikipedia.org/wiki/Adder_(electronics)',
  title: 'Adder (electronics) (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Adder (electronics) - Wikipedia',
  verifiedAt: '2026-10-05T16:27:02Z',
});

const N2T2 = link({
  url: 'https://www.nand2tetris.org/project02',
  title: 'Nand2Tetris Project 2: Boolean Arithmetic',
  kind: 'course',
  differsNote: 'Builds the Hack computer in its own HDL, not with this game\'s parts.',
  verifiedTitle: 'Project 02 | nand2tetris',
  verifiedAt: '2026-10-05T16:26:39Z',
});

const BE_ALU = link({
  url: 'https://www.youtube.com/watch?v=mOVOS9AjgFs',
  title: 'ALU design (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'ALU Design',
  verifiedAt: '2026-10-05T16:26:12Z',
});

const BE_TWOS = link({
  url: 'https://www.youtube.com/watch?v=4qH4unVtJkE',
  title: 'Two\'s complement: negative numbers in binary (Ben Eater)',
  kind: 'video',
  verifiedTitle: 'Twos complement: Negative numbers in binary',
  verifiedAt: '2026-10-05T16:26:20Z',
});

const WP_TWOS = link({
  url: 'https://en.wikipedia.org/wiki/Two%27s_complement',
  title: 'Two\'s complement (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Two\'s complement - Wikipedia',
  verifiedAt: '2026-10-05T16:27:05Z',
});

const WP_ALU = link({
  url: 'https://en.wikipedia.org/wiki/Arithmetic_logic_unit',
  title: 'Arithmetic logic unit (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Arithmetic logic unit - Wikipedia',
  verifiedAt: '2026-10-05T16:27:02Z',
});

const RV_RV32I = link({
  url: 'https://docs.riscv.org/reference/isa/v20260120/unpriv/rv32.html',
  title: 'RISC-V spec: RV32I Base Integer Instruction Set',
  kind: 'spec',
  verifiedTitle: '1.1. RV32I Base Integer Instruction Set, Version 2.1 :: RISC-V Ratified Specifications Library',
  verifiedAt: '2026-10-05T16:26:59Z',
});

const WP_SHIFTER = link({
  url: 'https://en.wikipedia.org/wiki/Barrel_shifter',
  title: 'Barrel shifter (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Barrel shifter - Wikipedia',
  verifiedAt: '2026-10-05T16:27:05Z',
});

const BE_FLAGS = link({
  url: 'https://www.youtube.com/watch?v=ObnosznZvHY',
  title: 'CPU flags register (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'CPU flags register',
  verifiedAt: '2026-10-05T16:26:15Z',
});

const BE_555 = link({
  url: 'https://www.youtube.com/watch?v=kRlSFm519Bo',
  title: 'Astable 555 timer: 8-bit computer clock, part 1 (Ben Eater)',
  kind: 'video',
  differsNote: 'Builds a real clock from a 555 timer chip; the game\'s clock is a part.',
  verifiedTitle: 'Astable 555 timer - 8-bit computer clock - part 1',
  verifiedAt: '2026-10-05T16:26:12Z',
});

const WP_CLOCK = link({
  url: 'https://en.wikipedia.org/wiki/Clock_signal',
  title: 'Clock signal (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Clock signal - Wikipedia',
  verifiedAt: '2026-10-05T16:27:03Z',
});

const BE_CLKLOGIC = link({
  url: 'https://www.youtube.com/watch?v=SmQ5K7UQPMM',
  title: 'Clock logic: 8-bit computer clock, part 4 (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Clock logic - 8-bit computer clock - part 4',
  verifiedAt: '2026-10-05T16:26:13Z',
});

const CC6 = link({
  url: 'https://www.youtube.com/watch?v=fpnE6UAfbtU',
  title: 'Registers and RAM (Crash Course Computer Science #6)',
  kind: 'video',
  verifiedTitle: 'Registers and RAM: Crash Course Computer Science #6',
  verifiedAt: '2026-10-05T16:26:24Z',
});

const BE_SR = link({
  url: 'https://www.youtube.com/watch?v=KM0DdEaY5sY',
  title: 'SR latch (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'SR latch',
  verifiedAt: '2026-10-05T16:26:19Z',
});

const LAGUE2 = link({
  url: 'https://www.youtube.com/watch?v=I0-izyq6q5s',
  title: 'How Do Computers Remember? (Sebastian Lague)',
  kind: 'video',
  verifiedTitle: 'How Do Computers Remember?',
  verifiedAt: '2026-10-05T16:26:33Z',
});

const WP_FF = link({
  url: 'https://en.wikipedia.org/wiki/Flip-flop_(electronics)',
  title: 'Flip-flop (electronics) (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Flip-flop (electronics) - Wikipedia',
  verifiedAt: '2026-10-05T16:27:04Z',
});

const BE_DL = link({
  url: 'https://www.youtube.com/watch?v=peCh_859q7Q',
  title: 'D latch (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'D latch',
  verifiedAt: '2026-10-05T16:26:15Z',
});

const BE_DFF = link({
  url: 'https://www.youtube.com/watch?v=YW-_GkUguMM',
  title: 'D flip-flop (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'D flip-flop',
  verifiedAt: '2026-10-05T16:26:14Z',
});

const N2T3 = link({
  url: 'https://www.nand2tetris.org/project03',
  title: 'Nand2Tetris Project 3: Memory',
  kind: 'course',
  differsNote: 'Builds the Hack computer in its own HDL, not with this game\'s parts.',
  verifiedTitle: 'Project 03 | nand2tetris',
  verifiedAt: '2026-10-05T16:26:39Z',
});

const BE_REG1 = link({
  url: 'https://www.youtube.com/watch?v=-arYx_oVIj8',
  title: 'Designing and building a 1-bit register (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Designing and building a 1-bit register - 8 bit register - Part 3',
  verifiedAt: '2026-10-05T16:26:18Z',
});

const BE_REG8 = link({
  url: 'https://www.youtube.com/watch?v=CiMaWbz_6E8',
  title: 'Building an 8-bit register (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Building an 8-bit register - 8-bit register - Part 4',
  verifiedAt: '2026-10-05T16:26:18Z',
});

const BE_BUS = link({
  url: 'https://www.youtube.com/watch?v=QzWW-CBugZo',
  title: 'Bus architecture and how register transfers work (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Bus architecture and how register transfers work - 8 bit register - Part 1',
  verifiedAt: '2026-10-05T16:26:13Z',
});

const BE_COUNTER = link({
  url: 'https://www.youtube.com/watch?v=exGEmA67dNc',
  title: 'Binary counter (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Binary counter',
  verifiedAt: '2026-10-05T16:26:13Z',
});

const BE_PC = link({
  url: 'https://www.youtube.com/watch?v=g_1HyxBzjl0',
  title: 'Program counter design (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Program counter design',
  verifiedAt: '2026-10-05T16:26:17Z',
});

const LAGUE4 = link({
  url: 'https://www.youtube.com/watch?v=_3cNcmli6xQ',
  title: 'Experimenting with Buses and Three-State Logic (Sebastian Lague)',
  kind: 'video',
  verifiedTitle: 'Experimenting with Buses and Three-State Logic',
  verifiedAt: '2026-10-05T16:26:33Z',
});

const BE_TRI = link({
  url: 'https://www.youtube.com/watch?v=faAjse109Q8',
  title: 'Tri-state logic: connecting multiple outputs together (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Tri-state logic: Connecting multiple outputs together - 8 bit register - Part 2',
  verifiedAt: '2026-10-05T16:26:19Z',
});

const LAGUE3 = link({
  url: 'https://www.youtube.com/watch?v=HGkuRp5HfH8',
  title: 'Simulating 256 Bytes of RAM (Sebastian Lague)',
  kind: 'video',
  verifiedTitle: 'Simulating 256 Bytes of RAM',
  verifiedAt: '2026-10-05T16:26:33Z',
});

const BE_RAM = link({
  url: 'https://www.youtube.com/watch?v=FnxPIZR1ybs',
  title: '8-bit computer RAM intro (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: '8-bit computer RAM intro',
  verifiedAt: '2026-10-05T16:26:18Z',
});

const BE_EEPROM = link({
  url: 'https://www.youtube.com/watch?v=BA12Z7gQ4P0',
  title: 'Using an EEPROM to replace combinational logic (Ben Eater)',
  kind: 'video',
  differsNote: 'Programs a real EEPROM chip; the game\'s ROM is a part.',
  verifiedTitle: 'Using an EEPROM to replace combinational logic',
  verifiedAt: '2026-10-05T16:26:15Z',
});

const CC19 = link({
  url: 'https://www.youtube.com/watch?v=TQCr9RV7twk',
  title: 'Memory & Storage (Crash Course Computer Science #19)',
  kind: 'video',
  verifiedTitle: 'Memory & Storage: Crash Course Computer Science #19',
  verifiedAt: '2026-10-05T16:26:21Z',
});

const WP_PC = link({
  url: 'https://en.wikipedia.org/wiki/Program_counter',
  title: 'Program counter (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Program counter - Wikipedia',
  verifiedAt: '2026-10-05T16:27:04Z',
});

const CC7 = link({
  url: 'https://www.youtube.com/watch?v=FZGugFqdr60',
  title: 'The Central Processing Unit (Crash Course Computer Science #7)',
  kind: 'video',
  differsNote: 'Uses a simplified made-up CPU, not Toy-8 or RISC-V.',
  verifiedTitle: 'The Central Processing Unit (CPU): Crash Course Computer Science #7',
  verifiedAt: '2026-10-05T16:26:24Z',
});

const WP_CYCLE = link({
  url: 'https://en.wikipedia.org/wiki/Instruction_cycle',
  title: 'Instruction cycle (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Instruction cycle - Wikipedia',
  verifiedAt: '2026-10-05T16:27:03Z',
});

const BE_CTRL_OVERVIEW = link({
  url: 'https://www.youtube.com/watch?v=AwUirxi9eBg',
  title: '8-bit CPU control signal overview (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: '8-bit CPU control signal overview',
  verifiedAt: '2026-10-05T16:26:14Z',
});

const BE_CTRL1 = link({
  url: 'https://www.youtube.com/watch?v=dXdoim96v5A',
  title: '8-bit CPU control logic: part 1 (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: '8-bit CPU control logic: Part 1',
  verifiedAt: '2026-10-05T16:26:14Z',
});

const N2T5 = link({
  url: 'https://www.nand2tetris.org/project05',
  title: 'Nand2Tetris Project 5: Computer Architecture',
  kind: 'course',
  differsNote: 'Builds the Hack CPU, not Toy-8.',
  verifiedTitle: 'Project 05 | nand2tetris',
  verifiedAt: '2026-10-05T16:26:39Z',
});

const CC8 = link({
  url: 'https://www.youtube.com/watch?v=zltgXvg6r3k',
  title: 'Instructions & Programs (Crash Course Computer Science #8)',
  kind: 'video',
  differsNote: 'Uses a simplified made-up CPU, not Toy-8 or RISC-V.',
  verifiedTitle: 'Instructions & Programs: Crash Course Computer Science #8',
  verifiedAt: '2026-10-05T16:26:25Z',
});

const BE_MOREINSN = link({
  url: 'https://www.youtube.com/watch?v=FCscQGBIL-Y',
  title: 'Adding more machine language instructions to the CPU (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Adding more machine language instructions to the CPU',
  verifiedAt: '2026-10-05T16:26:16Z',
});

const N2T4 = link({
  url: 'https://www.nand2tetris.org/project04',
  title: 'Nand2Tetris Project 4: Machine Language',
  kind: 'course',
  differsNote: 'Uses the Hack machine language, not Toy-8.',
  verifiedTitle: 'Project 04 | nand2tetris',
  verifiedAt: '2026-10-05T16:26:39Z',
});

const BE_JC = link({
  url: 'https://www.youtube.com/watch?v=Zg1NdPKoosU',
  title: 'Conditional jump instructions (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Conditional jump instructions',
  verifiedAt: '2026-10-05T16:26:16Z',
});

const BE_TURING = link({
  url: 'https://www.youtube.com/watch?v=AqNDk_UJW4k',
  title: 'Making a computer Turing complete (Ben Eater)',
  kind: 'video',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Making a computer Turing complete',
  verifiedAt: '2026-10-05T16:26:19Z',
});

const BE_PAGE = link({
  url: 'https://eater.net/8bit',
  title: 'Build an 8-bit computer (Ben Eater)',
  kind: 'course',
  differsNote: 'Real 74-series TTL chips on breadboards; his 8-bit design differs from Toy-8.',
  verifiedTitle: 'Build an 8-bit computer | Ben Eater',
  verifiedAt: '2026-10-05T16:26:17Z',
});

const RV_INDEX = link({
  url: 'https://docs.riscv.org/reference/isa/v20260120/index.html',
  title: 'The RISC-V Instruction Set Manuals (ratified)',
  kind: 'spec',
  verifiedTitle: 'RISC-V Instruction Set Architecture (ISA) Manuals :: RISC-V Ratified Specifications Library',
  verifiedAt: '2026-10-05T16:26:59Z',
});

const RV_LISTING = link({
  url: 'https://docs.riscv.org/reference/isa/v20260120/unpriv/rv-32-64g.html',
  title: 'RISC-V spec: RV32/64G Instruction Set Listings',
  kind: 'spec',
  verifiedTitle: '35.1. RV32/64G Instruction Set Listings :: RISC-V Ratified Specifications Library',
  verifiedAt: '2026-10-05T16:26:59Z',
});

const RVCODEC = link({
  url: 'https://luplab.gitlab.io/rvcodecjs/',
  title: 'rvcodec.js: RISC-V instruction encoder/decoder',
  kind: 'article',
  verifiedTitle: 'rvcodec.js · RISC-V Instruction Encoder/Decoder',
  verifiedAt: '2026-10-05T16:27:01Z',
});

const RV_M = link({
  url: 'https://docs.riscv.org/reference/isa/v20260120/unpriv/m-st-ext.html',
  title: 'RISC-V spec: "M" Extension for Multiplication and Division',
  kind: 'spec',
  verifiedTitle: '11.1. "M" Extension for Integer Multiplication and Division, Version 2.0 :: RISC-V Ratified Specifications Library',
  verifiedAt: '2026-10-05T16:26:59Z',
});

const RV_TESTS = link({
  url: 'https://github.com/riscv-software-src/riscv-tests',
  title: 'riscv-tests: the official RISC-V test programs',
  kind: 'course',
  verifiedTitle: 'GitHub - riscv-software-src/riscv-tests · GitHub',
  verifiedAt: '2026-10-05T16:27:00Z',
});

const WP_PIPELINE = link({
  url: 'https://en.wikipedia.org/wiki/Classic_RISC_pipeline',
  title: 'Classic RISC pipeline (Wikipedia)',
  kind: 'article',
  differsNote: 'Describes the MIPS-style pipeline; the stages match RISC-V.',
  verifiedTitle: 'Classic RISC pipeline - Wikipedia',
  verifiedAt: '2026-10-05T16:27:05Z',
});

const CC9 = link({
  url: 'https://www.youtube.com/watch?v=rtAlC5J1U40',
  title: 'Advanced CPU Designs (Crash Course Computer Science #9)',
  kind: 'video',
  verifiedTitle: 'Advanced CPU Designs: Crash Course Computer Science #9',
  verifiedAt: '2026-10-05T16:26:25Z',
});

const RV_PSABI = link({
  url: 'https://github.com/riscv-non-isa/riscv-elf-psabi-doc',
  title: 'RISC-V ELF psABI (calling convention and register names)',
  kind: 'spec',
  verifiedTitle: 'GitHub - riscv-non-isa/riscv-elf-psabi-doc: A RISC-V ELF psABI Document · GitHub',
  verifiedAt: '2026-10-05T16:26:59Z',
});

const RV_ASM = link({
  url: 'https://github.com/riscv-non-isa/riscv-asm-manual',
  title: 'RISC-V Assembly Programmer\'s Manual',
  kind: 'spec',
  verifiedTitle: 'GitHub - riscv-non-isa/riscv-asm-manual: RISC-V Assembly Programmer\'s Manual · GitHub',
  verifiedAt: '2026-10-05T16:26:58Z',
});

const BORIN = link({
  url: 'https://riscv-programming.org/book.html',
  title: 'An Introduction to Assembly Programming with RISC-V (Edson Borin)',
  kind: 'book',
  verifiedTitle: 'RISC-V Assembly Programming: About the Book',
  verifiedAt: '2026-10-05T16:26:20Z',
});

const GODBOLT = link({
  url: 'https://godbolt.org/',
  title: 'Compiler Explorer (pick a RISC-V rv32 compiler)',
  kind: 'article',
  verifiedTitle: 'Compiler Explorer',
  verifiedAt: '2026-10-05T16:26:28Z',
});

const WP_CALLSTACK = link({
  url: 'https://en.wikipedia.org/wiki/Call_stack',
  title: 'Call stack (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Call stack - Wikipedia',
  verifiedAt: '2026-10-05T16:27:03Z',
});

const WP_RECURSION = link({
  url: 'https://en.wikipedia.org/wiki/Recursion_(computer_science)',
  title: 'Recursion in computer science (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Recursion (computer science) - Wikipedia',
  verifiedAt: '2026-10-05T16:27:05Z',
});

const WP_CSTRING = link({
  url: 'https://en.wikipedia.org/wiki/Null-terminated_string',
  title: 'Null-terminated string (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Null-terminated string - Wikipedia',
  verifiedAt: '2026-10-05T16:27:03Z',
});

const N2T6 = link({
  url: 'https://www.nand2tetris.org/project06',
  title: 'Nand2Tetris Project 6: The Assembler',
  kind: 'course',
  differsNote: 'Writes an assembler for Hack, not RISC-V.',
  verifiedTitle: 'Project 06 | nand2tetris',
  verifiedAt: '2026-10-05T16:26:39Z',
});

const WP_MMIO = link({
  url: 'https://en.wikipedia.org/wiki/Memory-mapped_I/O_and_port-mapped_I/O',
  title: 'Memory-mapped I/O and port-mapped I/O (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Memory-mapped I/O and port-mapped I/O - Wikipedia',
  verifiedAt: '2026-10-05T16:27:04Z',
});

const OSTEP_IO = link({
  url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/file-devices.pdf',
  title: 'OSTEP chapter 36: I/O Devices',
  kind: 'book',
  differsNote: 'General OS text; examples use x86 and Unix rather than RISC-V.',
  verifiedTitle: 'I/O Devices',
  verifiedAt: '2026-10-05T16:27:22Z',
});

const CC22 = link({
  url: 'https://www.youtube.com/watch?v=4RPtJ9UyHS0',
  title: 'Keyboards & Command Line Interfaces (Crash Course Computer Science #22)',
  kind: 'video',
  verifiedTitle: 'Keyboards & Command Line Interfaces: Crash Course Computer Science #22',
  verifiedAt: '2026-10-05T16:26:22Z',
});

const WP_UART = link({
  url: 'https://en.wikipedia.org/wiki/Universal_asynchronous_receiver-transmitter',
  title: 'Universal asynchronous receiver-transmitter (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Universal asynchronous receiver-transmitter - Wikipedia',
  verifiedAt: '2026-10-05T16:27:05Z',
});

const WP_POLLING = link({
  url: 'https://en.wikipedia.org/wiki/Polling_(computer_science)',
  title: 'Polling (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Polling (computer science) - Wikipedia',
  verifiedAt: '2026-10-05T16:27:05Z',
});

const RV_ZICSR = link({
  url: 'https://docs.riscv.org/reference/isa/v20260120/unpriv/zicsr.html',
  title: 'RISC-V spec: "Zicsr" CSR Instructions',
  kind: 'spec',
  verifiedTitle: '5.1. "Zicsr" Extension for Control and Status Register (CSR) Instructions, Version 2.0 :: RISC-V Ratified Specifications Library',
  verifiedAt: '2026-10-05T16:27:00Z',
});

const RV_COUNTERS = link({
  url: 'https://docs.riscv.org/reference/isa/v20260120/unpriv/counters.html',
  title: 'RISC-V spec: Counters (Zicntr)',
  kind: 'spec',
  verifiedTitle: '6.1. "Zicntr" and "Zihpm" Extensions for Counters, Version 2.0 :: RISC-V Ratified Specifications Library',
  verifiedAt: '2026-10-05T16:26:58Z',
});

const RV_CSRS = link({
  url: 'https://docs.riscv.org/reference/isa/v20260120/priv/priv-csrs.html',
  title: 'RISC-V privileged spec: Control and Status Registers',
  kind: 'spec',
  verifiedTitle: '1.1. Control and Status Registers (CSRs) :: RISC-V Ratified Specifications Library',
  verifiedAt: '2026-10-05T16:26:58Z',
});

const RV_MACHINE = link({
  url: 'https://docs.riscv.org/reference/isa/v20260120/priv/machine.html',
  title: 'RISC-V privileged spec: Machine-Level ISA',
  kind: 'spec',
  verifiedTitle: '2.1. Machine-Level ISA, Version 1.13 :: RISC-V Ratified Specifications Library',
  verifiedAt: '2026-10-05T16:26:59Z',
});

const XV6BOOK = link({
  url: 'https://pdos.csail.mit.edu/6.1810/2024/xv6/book-riscv-rev4.pdf',
  title: 'xv6: a simple, Unix-like teaching operating system (the xv6 book)',
  kind: 'book',
  differsNote: 'xv6 targets 64-bit RISC-V (RV64, Sv39); this game is RV32 with Sv32.',
  verifiedTitle: 'xv6: a simple, Unix-like teaching operating system',
  verifiedAt: '2026-10-05T16:27:06Z',
});

const MIT_TRAPS = link({
  url: 'https://pdos.csail.mit.edu/6.1810/2024/labs/traps.html',
  title: 'MIT 6.1810 lab: Traps',
  kind: 'course',
  differsNote: 'xv6 targets 64-bit RISC-V (RV64, Sv39); this game is RV32 with Sv32.',
  verifiedTitle: 'Lab: Traps',
  verifiedAt: '2026-10-05T16:26:37Z',
});

const OSTEP_LDE = link({
  url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-mechanisms.pdf',
  title: 'OSTEP chapter 6: Limited Direct Execution',
  kind: 'book',
  differsNote: 'General OS text; examples use x86 and Unix rather than RISC-V.',
  verifiedTitle: 'Mechanism: Limited Direct Execution',
  verifiedAt: '2026-10-05T16:27:24Z',
});

const WP_INTERRUPT = link({
  url: 'https://en.wikipedia.org/wiki/Interrupt',
  title: 'Interrupt (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Interrupt - Wikipedia',
  verifiedAt: '2026-10-05T16:27:04Z',
});

const WP_FB = link({
  url: 'https://en.wikipedia.org/wiki/Framebuffer',
  title: 'Framebuffer (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Framebuffer - Wikipedia',
  verifiedAt: '2026-10-05T16:27:04Z',
});

const CC23 = link({
  url: 'https://www.youtube.com/watch?v=7Jr0SFMQ4Rs',
  title: 'Screens & 2D Graphics (Crash Course Computer Science #23)',
  kind: 'video',
  verifiedTitle: 'Screens & 2D Graphics: Crash Course Computer Science #23',
  verifiedAt: '2026-10-05T16:26:23Z',
});

const WP_BLOCK = link({
  url: 'https://en.wikipedia.org/wiki/Block_(data_storage)',
  title: 'Block (data storage) (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Block (data storage) - Wikipedia',
  verifiedAt: '2026-10-05T16:27:02Z',
});

const SANDLER = link({
  url: 'https://norasandler.com/2017/11/29/Write-a-Compiler.html',
  title: 'Writing a C Compiler, Part 1 (Nora Sandler)',
  kind: 'article',
  differsNote: 'Generates x86-64 assembly, not RISC-V.',
  verifiedTitle: 'Writing a C Compiler, Part 1',
  verifiedAt: '2026-10-05T16:27:01Z',
});

const CC11 = link({
  url: 'https://www.youtube.com/watch?v=RU1u-js7db8',
  title: 'The First Programming Languages (Crash Course Computer Science #11)',
  kind: 'video',
  verifiedTitle: 'The First Programming Languages: Crash Course Computer Science #11',
  verifiedAt: '2026-10-05T16:26:21Z',
});

const BEEJ = link({
  url: 'https://beej.us/guide/bgc/',
  title: 'Beej\'s Guide to C Programming',
  kind: 'book',
  verifiedTitle: 'Beej\'s Guide to C Programming',
  verifiedAt: '2026-10-05T16:26:20Z',
});

const CPP_POINTER = link({
  url: 'https://en.cppreference.com/c/language/pointer',
  title: 'Pointer declaration (cppreference)',
  kind: 'spec',
  verifiedTitle: 'Pointer declaration - cppreference.com',
  verifiedAt: '2026-10-05T16:26:26Z',
});

const CPP_STRUCT = link({
  url: 'https://en.cppreference.com/c/language/struct',
  title: 'Struct declaration (cppreference)',
  kind: 'spec',
  verifiedTitle: 'Struct declaration - cppreference.com',
  verifiedAt: '2026-10-05T16:26:26Z',
});

const CPP_PRINTF = link({
  url: 'https://en.cppreference.com/c/io/fprintf',
  title: 'printf (cppreference)',
  kind: 'spec',
  verifiedTitle: 'printf, fprintf, sprintf, snprintf, printf_s, fprintf_s, sprintf_s, snprintf_s - cppreference.com',
  verifiedAt: '2026-10-05T16:26:26Z',
});

const OSTEP_FREESPACE = link({
  url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/vm-freespace.pdf',
  title: 'OSTEP chapter 17: Free-Space Management',
  kind: 'book',
  differsNote: 'General OS text; examples use x86 and Unix rather than RISC-V.',
  verifiedTitle: 'Free-Space Management',
  verifiedAt: '2026-10-05T16:27:18Z',
});

const OSTEP_MEMAPI = link({
  url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/vm-api.pdf',
  title: 'OSTEP chapter 14: Memory API',
  kind: 'book',
  differsNote: 'General OS text; examples use x86 and Unix rather than RISC-V.',
  verifiedTitle: 'Interlude: Memory API',
  verifiedAt: '2026-10-05T16:27:25Z',
});

const CPP_MALLOC = link({
  url: 'https://en.cppreference.com/c/memory/malloc',
  title: 'malloc (cppreference)',
  kind: 'spec',
  verifiedTitle: 'malloc - cppreference.com',
  verifiedAt: '2026-10-05T16:26:26Z',
});

const CHIBICC = link({
  url: 'https://github.com/rui314/chibicc',
  title: 'chibicc: a small C compiler (Rui Ueyama)',
  kind: 'course',
  differsNote: 'Generates x86-64 assembly, not RISC-V.',
  verifiedTitle: 'GitHub - rui314/chibicc: A small C compiler · GitHub',
  verifiedAt: '2026-10-05T16:26:26Z',
});

const CRENSHAW = link({
  url: 'https://compilers.iecc.com/crenshaw/',
  title: 'Let\'s Build a Compiler (Jack Crenshaw)',
  kind: 'article',
  differsNote: 'Written in Pascal and emits Motorola 68000 assembly.',
  verifiedTitle: 'Let\'s Build a Compiler',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const SANDLER_BOOK = link({
  url: 'https://nostarch.com/writing-c-compiler',
  title: 'Writing a C Compiler (Nora Sandler, No Starch Press)',
  kind: 'book',
  differsNote: 'Generates x86-64 assembly, not RISC-V.',
  verifiedTitle: 'Writing a C Compiler | No Starch Press',
  verifiedAt: '2026-10-05T16:27:01Z',
});

const B_VECTORS = link({
  url: 'https://www.youtube.com/watch?v=fNk_zzaMoSs',
  title: 'Vectors (3Blue1Brown, Essence of linear algebra chapter 1)',
  kind: 'video',
  verifiedTitle: 'Vectors | Chapter 1, Essence of linear algebra',
  verifiedAt: '2026-10-05T16:26:11Z',
});

const WP_DOT = link({
  url: 'https://en.wikipedia.org/wiki/Dot_product',
  title: 'Dot product (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Dot product - Wikipedia',
  verifiedAt: '2026-10-05T16:27:03Z',
});

const D2L_LINALG = link({
  url: 'https://www.d2l.ai/chapter_preliminaries/linear-algebra.html',
  title: 'Dive into Deep Learning 2.3: Linear Algebra',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '2.3. Linear Algebra — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const WP_MATMUL = link({
  url: 'https://en.wikipedia.org/wiki/Matrix_multiplication',
  title: 'Matrix multiplication (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Matrix multiplication - Wikipedia',
  verifiedAt: '2026-10-05T16:27:04Z',
});

const NP_BROADCAST = link({
  url: 'https://numpy.org/doc/stable/user/basics.broadcasting.html',
  title: 'Broadcasting (NumPy manual)',
  kind: 'spec',
  differsNote: 'NumPy (Python) rules; the game\'s tensors follow the same idea.',
  verifiedTitle: 'Broadcasting — NumPy v2.5 Manual',
  verifiedAt: '2026-10-05T16:26:40Z',
});

const D2L_NDARRAY = link({
  url: 'https://www.d2l.ai/chapter_preliminaries/ndarray.html',
  title: 'Dive into Deep Learning 2.1: Data Manipulation (broadcasting)',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '2.1. Data Manipulation — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const D2L_SOFTMAX = link({
  url: 'https://www.d2l.ai/chapter_linear-classification/softmax-regression.html',
  title: 'Dive into Deep Learning 4.1: Softmax Regression',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '4.1. Softmax Regression — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:28Z',
});

const WP_SOFTMAX = link({
  url: 'https://en.wikipedia.org/wiki/Softmax_function',
  title: 'Softmax function (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Softmax function - Wikipedia',
  verifiedAt: '2026-10-05T16:27:05Z',
});

const B5 = link({
  url: 'https://www.youtube.com/watch?v=wjZofJX0v4M',
  title: 'Transformers, the tech behind LLMs (3Blue1Brown, chapter 5)',
  kind: 'video',
  verifiedTitle: 'Transformers, the tech behind LLMs | Deep Learning Chapter 5',
  verifiedAt: '2026-10-05T16:26:11Z',
});

const B1 = link({
  url: 'https://www.youtube.com/watch?v=aircAruvnKk',
  title: 'But what is a neural network? (3Blue1Brown, Deep Learning chapter 1)',
  kind: 'video',
  verifiedTitle: 'But what is a neural network? | Deep learning chapter 1',
  verifiedAt: '2026-10-05T16:26:09Z',
});

const WP_PERCEPTRON = link({
  url: 'https://en.wikipedia.org/wiki/Perceptron',
  title: 'Perceptron (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Perceptron - Wikipedia',
  verifiedAt: '2026-10-05T16:27:05Z',
});

const D2L_MLP = link({
  url: 'https://www.d2l.ai/chapter_multilayer-perceptrons/mlp.html',
  title: 'Dive into Deep Learning 5.1: Multilayer Perceptrons',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '5.1. Multilayer Perceptrons — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const D2L_LINREG = link({
  url: 'https://www.d2l.ai/chapter_linear-regression/linear-regression.html',
  title: 'Dive into Deep Learning 3.1: Linear Regression (loss functions)',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '3.1. Linear Regression — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const B_XENT = link({
  url: 'https://www.youtube.com/watch?v=GlYgs6v2YfU',
  title: 'But what is cross-entropy? (3Blue1Brown)',
  kind: 'video',
  verifiedTitle: 'But what is cross-entropy? | Compression is Intelligence Part 2',
  verifiedAt: '2026-10-05T16:26:12Z',
});

const WP_LOSS = link({
  url: 'https://en.wikipedia.org/wiki/Loss_function',
  title: 'Loss function (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Loss function - Wikipedia',
  verifiedAt: '2026-10-05T16:27:04Z',
});

const B2 = link({
  url: 'https://www.youtube.com/watch?v=IHZwWFHWa-w',
  title: 'Gradient descent, how neural networks learn (3Blue1Brown, chapter 2)',
  kind: 'video',
  verifiedTitle: 'Gradient descent, how neural networks learn | Deep Learning Chapter 2',
  verifiedAt: '2026-10-05T16:26:10Z',
});

const D2L_GD = link({
  url: 'https://www.d2l.ai/chapter_optimization/gd.html',
  title: 'Dive into Deep Learning 12.3: Gradient Descent',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '12.3. Gradient Descent — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const WP_GD = link({
  url: 'https://en.wikipedia.org/wiki/Gradient_descent',
  title: 'Gradient descent (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Gradient descent - Wikipedia',
  verifiedAt: '2026-10-05T16:27:04Z',
});

const B4 = link({
  url: 'https://www.youtube.com/watch?v=tIeHLnjs5U8',
  title: 'Backpropagation calculus (3Blue1Brown, chapter 4)',
  kind: 'video',
  verifiedTitle: 'Backpropagation calculus | Deep Learning Chapter 4',
  verifiedAt: '2026-10-05T16:26:10Z',
});

const COLAH_BACKPROP = link({
  url: 'https://colah.github.io/posts/2015-08-Backprop/',
  title: 'Calculus on Computational Graphs: Backpropagation (Chris Olah)',
  kind: 'article',
  verifiedTitle: 'Calculus on Computational Graphs: Backpropagation -- colah\'s blog',
  verifiedAt: '2026-10-05T16:26:26Z',
});

const D2L_BACKPROP = link({
  url: 'https://www.d2l.ai/chapter_multilayer-perceptrons/backprop.html',
  title: 'Dive into Deep Learning 5.3: Forward and Backward Propagation',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '5.3. Forward Propagation, Backward Propagation, and Computational Graphs — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const WP_CHAIN = link({
  url: 'https://en.wikipedia.org/wiki/Chain_rule',
  title: 'Chain rule (Wikipedia)',
  kind: 'article',
  verifiedTitle: 'Chain rule - Wikipedia',
  verifiedAt: '2026-10-05T16:27:03Z',
});

const K_MICROGRAD = link({
  url: 'https://www.youtube.com/watch?v=VMj-3S1tku0',
  title: 'The spelled-out intro to neural networks and backpropagation: building micrograd (Andrej Karpathy)',
  kind: 'video',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'The spelled-out intro to neural networks and backpropagation: building micrograd',
  verifiedAt: '2026-10-05T16:26:31Z',
});

const MICROGRAD = link({
  url: 'https://github.com/karpathy/micrograd',
  title: 'micrograd: a tiny autograd engine (Andrej Karpathy)',
  kind: 'course',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'GitHub - karpathy/micrograd: A tiny scalar-valued autograd engine and a neural net library on top of it with PyTorch-like API · GitHub',
  verifiedAt: '2026-10-05T16:26:34Z',
});

const D2L_AUTOGRAD = link({
  url: 'https://www.d2l.ai/chapter_preliminaries/autograd.html',
  title: 'Dive into Deep Learning 2.5: Automatic Differentiation',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '2.5. Automatic Differentiation — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const CS231N_OPT2 = link({
  url: 'https://cs231n.github.io/optimization-2/',
  title: 'CS231n notes: Backpropagation, intuitions',
  kind: 'course',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'CS231n Deep Learning for Computer Vision',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const B3 = link({
  url: 'https://www.youtube.com/watch?v=Ilg3gGewQ5U',
  title: 'Backpropagation, intuitively (3Blue1Brown, chapter 3)',
  kind: 'video',
  verifiedTitle: 'Backpropagation, intuitively | Deep Learning Chapter 3',
  verifiedAt: '2026-10-05T16:26:10Z',
});

const CS231N_NN3 = link({
  url: 'https://cs231n.github.io/neural-networks-3/',
  title: 'CS231n notes: Learning (gradient checks, learning rates)',
  kind: 'course',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'CS231n Deep Learning for Computer Vision',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const K_MAKEMORE2 = link({
  url: 'https://www.youtube.com/watch?v=TCH_1BHY58I',
  title: 'Building makemore Part 2: MLP (Andrej Karpathy)',
  kind: 'video',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'Building makemore Part 2: MLP',
  verifiedAt: '2026-10-05T16:26:31Z',
});

const D2L_GENERALIZATION = link({
  url: 'https://www.d2l.ai/chapter_linear-regression/generalization.html',
  title: 'Dive into Deep Learning 3.6: Generalization',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '3.6. Generalization — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const Z2H = link({
  url: 'https://karpathy.ai/zero-to-hero.html',
  title: 'Neural Networks: Zero to Hero (Andrej Karpathy)',
  kind: 'course',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'Neural Networks: Zero To Hero',
  verifiedAt: '2026-10-05T16:27:08Z',
});

const K_MAKEMORE1 = link({
  url: 'https://www.youtube.com/watch?v=PaCmpygFfXo',
  title: 'The spelled-out intro to language modeling: building makemore (Andrej Karpathy)',
  kind: 'video',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'The spelled-out intro to language modeling: building makemore',
  verifiedAt: '2026-10-05T16:26:30Z',
});

const D2L_TEXT = link({
  url: 'https://www.d2l.ai/chapter_recurrent-neural-networks/text-sequence.html',
  title: 'Dive into Deep Learning 9.2: Converting Raw Text into Sequence Data',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '9.2. Converting Raw Text into Sequence Data — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:28Z',
});

const K_TOKENIZER = link({
  url: 'https://www.youtube.com/watch?v=zduSFxRajkE',
  title: 'Let\'s build the GPT Tokenizer (Andrej Karpathy)',
  kind: 'video',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'Let\'s build the GPT Tokenizer',
  verifiedAt: '2026-10-05T16:26:32Z',
});

const MINBPE = link({
  url: 'https://github.com/karpathy/minbpe',
  title: 'minbpe: minimal byte pair encoding (Andrej Karpathy)',
  kind: 'course',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'GitHub - karpathy/minbpe: Minimal, clean code for the Byte Pair Encoding (BPE) algorithm commonly used in LLM tokenization. · GitHub',
  verifiedAt: '2026-10-05T16:26:35Z',
});

const SENNRICH = link({
  url: 'https://arxiv.org/abs/1508.07909',
  title: 'Neural Machine Translation of Rare Words with Subword Units (Sennrich et al., 2015)',
  kind: 'article',
  verifiedTitle: '[1508.07909] Neural Machine Translation of Rare Words with Subword Units',
  verifiedAt: '2026-10-05T16:27:01Z',
});

const HF_BPE = link({
  url: 'https://huggingface.co/learn/llm-course/chapter6/5',
  title: 'Byte-Pair Encoding tokenization (Hugging Face LLM course)',
  kind: 'course',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'Byte-Pair Encoding tokenization · Hugging Face',
  verifiedAt: '2026-10-05T16:26:29Z',
});

const ILLUSTRATED = link({
  url: 'https://jalammar.github.io/illustrated-transformer/',
  title: 'The Illustrated Transformer (Jay Alammar)',
  kind: 'article',
  verifiedTitle: 'The Illustrated Transformer – Jay Alammar – Visualizing machine learning one concept at a time.',
  verifiedAt: '2026-10-05T16:26:29Z',
});

const MAKEMORE = link({
  url: 'https://github.com/karpathy/makemore',
  title: 'makemore (Andrej Karpathy)',
  kind: 'course',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'GitHub - karpathy/makemore: An autoregressive character-level language model for making more things · GitHub',
  verifiedAt: '2026-10-05T16:26:34Z',
});

const D2L_LM = link({
  url: 'https://www.d2l.ai/chapter_recurrent-neural-networks/language-model.html',
  title: 'Dive into Deep Learning 9.3: Language Models (perplexity)',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '9.3. Language Models — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const D2L_SELFATTN = link({
  url: 'https://www.d2l.ai/chapter_attention-mechanisms-and-transformers/self-attention-and-positional-encoding.html',
  title: 'Dive into Deep Learning 11.6: Self-Attention and Positional Encoding',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '11.6. Self-Attention and Positional Encoding — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const AIAYN = link({
  url: 'https://arxiv.org/abs/1706.03762',
  title: 'Attention Is All You Need (Vaswani et al., 2017)',
  kind: 'article',
  verifiedTitle: '[1706.03762] Attention Is All You Need',
  verifiedAt: '2026-10-05T16:26:09Z',
});

const B6 = link({
  url: 'https://www.youtube.com/watch?v=eMlx5fFNoYc',
  title: 'Attention in transformers, step-by-step (3Blue1Brown, chapter 6)',
  kind: 'video',
  verifiedTitle: 'Attention in transformers, step-by-step | Deep Learning Chapter 6',
  verifiedAt: '2026-10-05T16:26:11Z',
});

const K_GPT = link({
  url: 'https://www.youtube.com/watch?v=kCc8FmEb1nY',
  title: 'Let\'s build GPT: from scratch, in code, spelled out (Andrej Karpathy)',
  kind: 'video',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'Let\'s build GPT: from scratch, in code, spelled out.',
  verifiedAt: '2026-10-05T16:26:30Z',
});

const ILLUSTRATED_GPT2 = link({
  url: 'https://jalammar.github.io/illustrated-gpt2/',
  title: 'The Illustrated GPT-2 (Jay Alammar)',
  kind: 'article',
  verifiedTitle: 'The Illustrated GPT-2 (Visualizing Transformer Language Models) – Jay Alammar – Visualizing machine learning one concept at a time.',
  verifiedAt: '2026-10-05T16:26:29Z',
});

const D2L_MHA = link({
  url: 'https://www.d2l.ai/chapter_attention-mechanisms-and-transformers/multihead-attention.html',
  title: 'Dive into Deep Learning 11.5: Multi-Head Attention',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '11.5. Multi-Head Attention — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:27Z',
});

const ANNOTATED = link({
  url: 'https://nlp.seas.harvard.edu/annotated-transformer/',
  title: 'The Annotated Transformer (Harvard NLP)',
  kind: 'article',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'The Annotated Transformer',
  verifiedAt: '2026-10-05T16:26:09Z',
});

const LAYERNORM = link({
  url: 'https://arxiv.org/abs/1607.06450',
  title: 'Layer Normalization (Ba, Kiros and Hinton, 2016)',
  kind: 'article',
  verifiedTitle: '[1607.06450] Layer Normalization',
  verifiedAt: '2026-10-05T16:26:33Z',
});

const RESNET = link({
  url: 'https://arxiv.org/abs/1512.03385',
  title: 'Deep Residual Learning for Image Recognition (He et al., 2015)',
  kind: 'article',
  verifiedTitle: '[1512.03385] Deep Residual Learning for Image Recognition',
  verifiedAt: '2026-10-05T16:26:58Z',
});

const D2L_TRANSFORMER = link({
  url: 'https://www.d2l.ai/chapter_attention-mechanisms-and-transformers/transformer.html',
  title: 'Dive into Deep Learning 11.7: The Transformer Architecture',
  kind: 'book',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: '11.7. The Transformer Architecture — Dive into Deep Learning 1.0.3 documentation',
  verifiedAt: '2026-10-05T16:26:28Z',
});

const NANOGPT = link({
  url: 'https://github.com/karpathy/nanoGPT',
  title: 'nanoGPT (Andrej Karpathy)',
  kind: 'course',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'GitHub - karpathy/nanoGPT: The simplest, fastest repository for training/finetuning medium-sized GPTs. · GitHub',
  verifiedAt: '2026-10-05T16:26:40Z',
});

const GUTENBERG = link({
  url: 'https://www.gutenberg.org/',
  title: 'Project Gutenberg: free public-domain ebooks',
  kind: 'article',
  verifiedTitle: 'Free eBooks | Project Gutenberg',
  verifiedAt: '2026-10-05T16:26:29Z',
});

const KARPATHY_RNN = link({
  url: 'https://karpathy.github.io/2015/05/21/rnn-effectiveness/',
  title: 'The Unreasonable Effectiveness of Recurrent Neural Networks (Andrej Karpathy)',
  kind: 'article',
  verifiedTitle: 'The Unreasonable Effectiveness of Recurrent Neural Networks',
  verifiedAt: '2026-10-05T16:26:32Z',
});

const K_MAKEMORE3 = link({
  url: 'https://www.youtube.com/watch?v=P6sfmUTpUmc',
  title: 'Building makemore Part 3: Activations & Gradients, BatchNorm (Andrej Karpathy)',
  kind: 'video',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'Building makemore Part 3: Activations & Gradients, BatchNorm',
  verifiedAt: '2026-10-05T16:26:31Z',
});

const HOLTZMAN = link({
  url: 'https://arxiv.org/abs/1904.09751',
  title: 'The Curious Case of Neural Text Degeneration (Holtzman et al., 2019)',
  kind: 'article',
  verifiedTitle: '[1904.09751] The Curious Case of Neural Text Degeneration',
  verifiedAt: '2026-10-05T16:26:29Z',
});

const FAN_TOPK = link({
  url: 'https://arxiv.org/abs/1805.04833',
  title: 'Hierarchical Neural Story Generation (Fan et al., 2018)',
  kind: 'article',
  verifiedTitle: '[1805.04833] Hierarchical Neural Story Generation',
  verifiedAt: '2026-10-05T16:26:28Z',
});

const K_GPT2 = link({
  url: 'https://www.youtube.com/watch?v=l8pRSuU81PU',
  title: 'Let\'s reproduce GPT-2 (124M) (Andrej Karpathy)',
  kind: 'video',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'Let\'s reproduce GPT-2 (124M)',
  verifiedAt: '2026-10-05T16:26:30Z',
});

const GPT3 = link({
  url: 'https://arxiv.org/abs/2005.14165',
  title: 'Language Models are Few-Shot Learners (Brown et al., 2020)',
  kind: 'article',
  verifiedTitle: '[2005.14165] Language Models are Few-Shot Learners',
  verifiedAt: '2026-10-05T16:26:28Z',
});

const LORA = link({
  url: 'https://arxiv.org/abs/2106.09685',
  title: 'LoRA: Low-Rank Adaptation of Large Language Models (Hu et al., 2021)',
  kind: 'article',
  verifiedTitle: '[2106.09685] LoRA: Low-Rank Adaptation of Large Language Models',
  verifiedAt: '2026-10-05T16:26:33Z',
});

const PEFT = link({
  url: 'https://huggingface.co/docs/peft/index',
  title: 'PEFT: parameter-efficient fine-tuning (Hugging Face)',
  kind: 'spec',
  differsNote: 'Code is in Python; the game uses JavaScript.',
  verifiedTitle: 'PEFT · Hugging Face',
  verifiedAt: '2026-10-05T16:26:58Z',
});

const INSTRUCTGPT = link({
  url: 'https://arxiv.org/abs/2203.02155',
  title: 'Training language models to follow instructions with human feedback (Ouyang et al., 2022)',
  kind: 'article',
  verifiedTitle: '[2203.02155] Training language models to follow instructions with human feedback',
  verifiedAt: '2026-10-05T16:26:29Z',
});

const ZIEGLER = link({
  url: 'https://arxiv.org/abs/1909.08593',
  title: 'Fine-Tuning Language Models from Human Preferences (Ziegler et al., 2019)',
  kind: 'article',
  verifiedTitle: '[1909.08593] Fine-Tuning Language Models from Human Preferences',
  verifiedAt: '2026-10-05T16:27:08Z',
});

const DPO = link({
  url: 'https://arxiv.org/abs/2305.18290',
  title: 'Direct Preference Optimization (Rafailov et al., 2023)',
  kind: 'article',
  verifiedTitle: '[2305.18290] Direct Preference Optimization: Your Language Model is Secretly a Reward Model',
  verifiedAt: '2026-10-05T16:26:28Z',
});

const KAPLAN = link({
  url: 'https://arxiv.org/abs/2001.08361',
  title: 'Scaling Laws for Neural Language Models (Kaplan et al., 2020)',
  kind: 'article',
  verifiedTitle: '[2001.08361] Scaling Laws for Neural Language Models',
  verifiedAt: '2026-10-05T16:26:32Z',
});

const CHINCHILLA = link({
  url: 'https://arxiv.org/abs/2203.15556',
  title: 'Training Compute-Optimal Large Language Models (Hoffmann et al., 2022)',
  kind: 'article',
  verifiedTitle: '[2203.15556] Training Compute-Optimal Large Language Models',
  verifiedAt: '2026-10-05T16:26:26Z',
});

const XV6SRC = link({
  url: 'https://github.com/mit-pdos/xv6-riscv',
  title: 'xv6-riscv source code',
  kind: 'course',
  differsNote: 'xv6 targets 64-bit RISC-V (RV64, Sv39); this game is RV32 with Sv32.',
  verifiedTitle: 'GitHub - mit-pdos/xv6-riscv: Xv6 for RISC-V · GitHub',
  verifiedAt: '2026-10-05T16:27:08Z',
});

const CC18 = link({
  url: 'https://www.youtube.com/watch?v=26QPDBe-NB8',
  title: 'Operating Systems (Crash Course Computer Science #18)',
  kind: 'video',
  verifiedTitle: 'Operating Systems: Crash Course Computer Science #18',
  verifiedAt: '2026-10-05T16:26:21Z',
});

const RV_SUPER = link({
  url: 'https://docs.riscv.org/reference/isa/v20260120/priv/supervisor.html',
  title: 'RISC-V privileged spec: Supervisor-Level ISA (Sv32 paging)',
  kind: 'spec',
  verifiedTitle: '11.1. Supervisor-Level ISA, Version 1.13 :: RISC-V Ratified Specifications Library',
  verifiedAt: '2026-10-05T16:26:59Z',
});

const MIT_SYSCALL = link({
  url: 'https://pdos.csail.mit.edu/6.1810/2024/labs/syscall.html',
  title: 'MIT 6.1810 lab: System calls',
  kind: 'course',
  differsNote: 'xv6 targets 64-bit RISC-V (RV64, Sv39); this game is RV32 with Sv32.',
  verifiedTitle: 'Lab: System calls',
  verifiedAt: '2026-10-05T16:26:36Z',
});

const OSTEP_PROCESS = link({
  url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-intro.pdf',
  title: 'OSTEP chapter 4: The Abstraction: The Process',
  kind: 'book',
  differsNote: 'General OS text; examples use x86 and Unix rather than RISC-V.',
  verifiedTitle: 'The Abstraction: The Process',
  verifiedAt: '2026-10-05T16:27:31Z',
});

const OSTEP_PROCAPI = link({
  url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-api.pdf',
  title: 'OSTEP chapter 5: Process API',
  kind: 'book',
  differsNote: 'General OS text; examples use x86 and Unix rather than RISC-V.',
  verifiedTitle: 'Interlude: Process API',
  verifiedAt: '2026-10-05T16:27:29Z',
});

const MIT_THREAD = link({
  url: 'https://pdos.csail.mit.edu/6.1810/2024/labs/thread.html',
  title: 'MIT 6.1810 lab: Multithreading',
  kind: 'course',
  differsNote: 'xv6 targets 64-bit RISC-V (RV64, Sv39); this game is RV32 with Sv32.',
  verifiedTitle: 'Lab: Multithreading',
  verifiedAt: '2026-10-05T16:26:37Z',
});

const OSTEP_SCHED = link({
  url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/cpu-sched.pdf',
  title: 'OSTEP chapter 7: Scheduling',
  kind: 'book',
  differsNote: 'General OS text; examples use x86 and Unix rather than RISC-V.',
  verifiedTitle: 'Scheduling: Introduction',
  verifiedAt: '2026-10-05T16:27:33Z',
});

const OSTEP_PAGING = link({
  url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/vm-paging.pdf',
  title: 'OSTEP chapter 18: Paging',
  kind: 'book',
  differsNote: 'General OS text; examples use x86 and Unix rather than RISC-V.',
  verifiedTitle: 'Paging: Introduction',
  verifiedAt: '2026-10-05T16:27:27Z',
});

const MIT_PGTBL = link({
  url: 'https://pdos.csail.mit.edu/6.1810/2024/labs/pgtbl.html',
  title: 'MIT 6.1810 lab: Page tables',
  kind: 'course',
  differsNote: 'xv6 targets 64-bit RISC-V (RV64, Sv39); this game is RV32 with Sv32.',
  verifiedTitle: 'Lab: page tables',
  verifiedAt: '2026-10-05T16:26:36Z',
});

const OSTEP_FS = link({
  url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/file-implementation.pdf',
  title: 'OSTEP chapter 40: File System Implementation',
  kind: 'book',
  differsNote: 'General OS text; examples use x86 and Unix rather than RISC-V.',
  verifiedTitle: 'File System Implementation',
  verifiedAt: '2026-10-05T16:27:20Z',
});

const CC20 = link({
  url: 'https://www.youtube.com/watch?v=KN8YgJnShPM',
  title: 'Files & File Systems (Crash Course Computer Science #20)',
  kind: 'video',
  verifiedTitle: 'Files & File Systems: Crash Course Computer Science #20',
  verifiedAt: '2026-10-05T16:26:22Z',
});

const MIT_FS = link({
  url: 'https://pdos.csail.mit.edu/6.1810/2024/labs/fs.html',
  title: 'MIT 6.1810 lab: File system',
  kind: 'course',
  differsNote: 'xv6 targets 64-bit RISC-V (RV64, Sv39); this game is RV32 with Sv32.',
  verifiedTitle: 'Lab: file system',
  verifiedAt: '2026-10-05T16:26:35Z',
});

const MIT_UTIL = link({
  url: 'https://pdos.csail.mit.edu/6.1810/2024/labs/util.html',
  title: 'MIT 6.1810 lab: Xv6 and Unix utilities',
  kind: 'course',
  differsNote: 'xv6 targets 64-bit RISC-V (RV64, Sv39); this game is RV32 with Sv32.',
  verifiedTitle: 'Lab: Xv6 and Unix utilities',
  verifiedAt: '2026-10-05T16:26:38Z',
});

const OSTEP = link({
  url: 'https://pages.cs.wisc.edu/~remzi/OSTEP/',
  title: 'Operating Systems: Three Easy Pieces',
  kind: 'book',
  differsNote: 'General OS text; examples use x86 and Unix rather than RISC-V.',
  verifiedTitle: 'Operating Systems: Three Easy Pieces',
  verifiedAt: '2026-10-05T16:26:41Z',
});

export const RESOURCES: Record<string, Resource[]> = {
  'wires-and-lamps': [start(CC3), CC2, LAGUE1],
  'switches': [start(CC2), CC3, LAGUE1],
  'meet-nand': [start(LAGUE1), WP_NAND, CC3, N2T1],
  'not-gate': [start(CC3), LAGUE1, WP_GATE, N2T1],
  'and-gate': [start(CC3), LAGUE1, WP_GATE, N2T1],
  'or-gate': [start(CC3), LAGUE1, WP_GATE, N2T1],
  'nor-gate': [start(CC3), WP_COMPLETE, WP_NAND, N2T1],
  'xor-gate': [start(CC3), LAGUE1, WP_GATE, N2T1],
  'xnor-gate': [start(CC3), WP_GATE, N2T1],
  'and3-gate': [start(CC3), WP_GATE, N2T1],
  'mux': [start(WP_MUX), N2T1, CC3],
  'demux': [start(WP_MUX), N2T1, CC3],
  'decoder-2to4': [start(WP_DECODER), BE_HEX, N2T1],
  'binary-counting': [start(CC4), WP_BINARY],
  'half-adder': [start(CC5), LAGUE1, WP_ADDER, N2T2],
  'full-adder': [start(CC5), LAGUE1, WP_ADDER, N2T2],
  'adder-8bit': [start(CC5), WP_ADDER, N2T2, BE_ALU],
  'negation': [start(BE_TWOS), WP_TWOS, CC4],
  'subtractor': [start(BE_TWOS), CC5, WP_TWOS, BE_ALU],
  'equality': [start(CC5), WP_ALU, N2T2],
  'less-than': [start(CC5), WP_TWOS, RV_RV32I],
  'logic-unit': [start(CC5), WP_ALU, N2T2],
  'shifter': [start(WP_SHIFTER), CC5, RV_RV32I],
  'alu-8bit': [start(CC5), BE_ALU, BE_FLAGS, N2T2],
  'alu-32bit': [start(CC5), WP_ALU, RV_RV32I],
  'the-clock': [start(BE_555), WP_CLOCK, BE_CLKLOGIC, CC6],
  'sr-latch': [start(BE_SR), LAGUE2, WP_FF, CC6],
  'd-latch': [start(BE_DL), LAGUE2, WP_FF, CC6],
  'd-flip-flop': [start(BE_DFF), WP_FF, N2T3, LAGUE2],
  'register-enable': [start(CC6), BE_REG1, LAGUE2, N2T3],
  'register-8bit': [start(BE_REG8), CC6, BE_BUS, N2T3],
  'counter-8bit': [start(BE_COUNTER), BE_PC, N2T3],
  'register-file': [start(CC6), LAGUE4, BE_TRI, N2T3],
  'ram-16x8': [start(CC6), LAGUE3, BE_RAM, N2T3],
  'rom-lookup': [start(BE_EEPROM), CC19],
  'program-counter': [start(BE_PC), WP_PC, CC7],
  'fetch': [start(CC7), WP_CYCLE, BE_CTRL_OVERVIEW],
  'instruction-decoder': [start(CC7), BE_CTRL1, BE_CTRL_OVERVIEW, N2T5],
  'register-file-wiring': [start(CC7), BE_BUS, N2T5],
  'alu-execute': [start(CC7), BE_CTRL1, N2T5],
  'load-store': [start(CC8), CC7, BE_RAM, N2T5],
  'jump': [start(CC8), BE_MOREINSN, N2T4],
  'conditional-branch': [start(BE_JC), BE_FLAGS, BE_TURING, CC8],
  'halt': [start(CC8), BE_CTRL_OVERVIEW, BE_PAGE],
  'first-program': [start(CC8), N2T4, BE_TURING],
  'rv-register-file': [start(RV_RV32I), RV_INDEX, CC6],
  'immediate-generator': [start(RV_RV32I), RV_LISTING, RVCODEC],
  'alu-control': [start(RV_RV32I), RV_LISTING, RV_M],
  'branch-comparator': [start(RV_RV32I), RV_LISTING, WP_TWOS],
  'load-store-unit': [start(RV_RV32I), RV_LISTING, WP_TWOS],
  'next-pc': [start(RV_RV32I), RV_LISTING, WP_PC],
  'single-cycle-datapath': [start(RV_RV32I), CC7, RV_LISTING, RVCODEC],
  'running-programs': [start(RV_TESTS), RV_RV32I, RVCODEC],
  'rv-pipeline': [start(WP_PIPELINE), CC9, RV_RV32I],
  'hand-encode': [start(RVCODEC), RV_LISTING, RV_RV32I],
  'abi-names': [start(RV_PSABI), RV_ASM, BORIN],
  'loop-sum': [start(BORIN), RV_ASM, GODBOLT],
  'array-sum-max': [start(BORIN), RV_ASM, GODBOLT],
  'functions-stack': [start(BORIN), RV_PSABI, WP_CALLSTACK],
  'recursion': [start(BORIN), WP_RECURSION, WP_CALLSTACK],
  'strings-uart': [start(BORIN), WP_CSTRING, RV_ASM],
  'encode-addi': [start(N2T6), RVCODEC, RV_LISTING, RV_ASM],
  'mmio-basics': [start(WP_MMIO), OSTEP_IO, CC22],
  'uart-output': [start(WP_UART), OSTEP_IO, WP_MMIO],
  'keyboard-polling': [start(WP_POLLING), OSTEP_IO, CC22],
  'csr-timer': [start(RV_ZICSR), RV_COUNTERS, RV_CSRS],
  'trap-handler': [start(RV_MACHINE), XV6BOOK, MIT_TRAPS, OSTEP_LDE],
  'timer-interrupt': [start(RV_MACHINE), WP_INTERRUPT, OSTEP_LDE, XV6BOOK],
  'draw-framebuffer': [start(WP_FB), CC23],
  'block-device': [start(OSTEP_IO), WP_BLOCK, CC19],
  'c-by-hand': [start(GODBOLT), RV_PSABI, SANDLER, CC11],
  'c-control-flow': [start(BEEJ), GODBOLT, SANDLER],
  'c-functions': [start(BEEJ), RV_PSABI, GODBOLT, WP_CALLSTACK],
  'c-pointers': [start(BEEJ), CPP_POINTER, GODBOLT],
  'c-structs': [start(BEEJ), CPP_STRUCT, GODBOLT],
  'c-strings': [start(BEEJ), CPP_PRINTF, WP_CSTRING],
  'c-heap': [start(OSTEP_FREESPACE), OSTEP_MEMAPI, CPP_MALLOC, BEEJ],
  'c-compiler': [start(SANDLER), CHIBICC, CRENSHAW, SANDLER_BOOK],
  'vectors-dot': [start(B_VECTORS), WP_DOT, D2L_LINALG],
  'matmul': [start(D2L_LINALG), WP_MATMUL, B_VECTORS],
  'broadcasting': [start(NP_BROADCAST), D2L_NDARRAY],
  'softmax': [start(D2L_SOFTMAX), WP_SOFTMAX, B5],
  'a-neuron': [start(B1), WP_PERCEPTRON, D2L_MLP],
  'loss-functions': [start(D2L_LINREG), B_XENT, WP_LOSS],
  'gradient-descent-1d': [start(B2), D2L_GD, WP_GD],
  'chain-rule': [start(B4), COLAH_BACKPROP, D2L_BACKPROP, WP_CHAIN],
  'autograd': [start(K_MICROGRAD), MICROGRAD, D2L_AUTOGRAD, CS231N_OPT2],
  'mlp-xor': [start(B1), D2L_MLP, B3, K_MICROGRAD],
  'training-loop': [start(B2), CS231N_NN3, K_MAKEMORE2],
  'overfitting': [start(D2L_GENERALIZATION), K_MAKEMORE2],
  'digit-recognizer': [start(B1), B3, Z2H],
  'char-tokenizer': [start(K_MAKEMORE1), D2L_TEXT, K_TOKENIZER],
  'bpe-tokenizer': [start(K_TOKENIZER), MINBPE, SENNRICH, HF_BPE],
  'token-embeddings': [start(K_MAKEMORE2), B5, ILLUSTRATED],
  'bigram-lm': [start(K_MAKEMORE1), MAKEMORE, D2L_LM],
  'positional-encoding': [start(D2L_SELFATTN), AIAYN, ILLUSTRATED],
  'self-attention': [start(B6), K_GPT, AIAYN, ILLUSTRATED],
  'causal-mask': [start(K_GPT), ILLUSTRATED_GPT2, B6],
  'multi-head-attention': [start(D2L_MHA), AIAYN, B6, ANNOTATED],
  'layer-norm-residual': [start(K_GPT), LAYERNORM, RESNET, D2L_TRANSFORMER],
  'transformer-block': [start(K_GPT), ANNOTATED, D2L_TRANSFORMER, AIAYN],
  'batching-pipeline': [start(K_GPT), NANOGPT, K_MAKEMORE2],
  'train-tiny-gpt': [start(K_GPT), GUTENBERG, KARPATHY_RNN, NANOGPT],
  'loss-perplexity': [start(D2L_LM), K_MAKEMORE1, K_MAKEMORE3],
  'sampling': [start(HOLTZMAN), FAN_TOPK, K_GPT],
  'fine-tuning': [start(K_GPT2), GPT3, NANOGPT],
  'lora': [start(LORA), PEFT],
  'preference-model': [start(INSTRUCTGPT), ZIEGLER, DPO],
  'scaling-experiment': [start(KAPLAN), CHINCHILLA],
  'os-bootloader': [start(XV6BOOK), XV6SRC, CC18, OSTEP_LDE],
  'os-trap-vector': [start(XV6BOOK), RV_MACHINE, MIT_TRAPS, RV_SUPER],
  'os-system-calls': [start(MIT_SYSCALL), OSTEP_LDE, XV6BOOK],
  'os-context-switch': [start(OSTEP_PROCESS), OSTEP_PROCAPI, MIT_THREAD, XV6BOOK],
  'os-preemption': [start(OSTEP_SCHED), XV6BOOK, CC18],
  'os-virtual-memory': [start(OSTEP_PAGING), RV_SUPER, MIT_PGTBL, XV6BOOK],
  'os-page-allocator': [start(OSTEP_FREESPACE), XV6BOOK],
  'os-file-system': [start(OSTEP_FS), CC20, MIT_FS, XV6BOOK],
  'os-shell': [start(MIT_UTIL), OSTEP_PROCAPI, XV6BOOK, CC22],
  'os-final-game': [start(CC18), XV6BOOK, OSTEP],
};
