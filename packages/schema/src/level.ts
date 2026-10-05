import { z } from 'zod';
import { Board, PartType } from './board';

/** A value on a labelled input or output: an unsigned integer up to 32 bits (1-bit pins use 0/1). */
const Num = z.number().int().min(0).max(0xffffffff);
const Values = z.record(z.string(), Num);

/** One row of a truth-table test: input values by label, expected outputs by label. */
export const TruthRow = z.object({ inputs: Values, expect: Values });
export type TruthRow = z.infer<typeof TruthRow>;

/** One step of a clocked sequence test (LVL-07). */
export const SequenceStep = z.object({
  /** Inputs to set before ticking. */
  set: Values.optional(),
  /** Clock half-periods (ticks) to run after setting inputs. 2 = one full cycle. */
  ticks: z.number().int().min(0).max(1_000_000).default(0),
  /** Outputs to check after ticking. */
  expect: Values.optional(),
  /** Power cycle before this step: 'off' then 'on' (E-SIM-08 style checks). */
  power: z.enum(['cycle']).optional(),
});
export type SequenceStep = z.infer<typeof SequenceStep>;

export const TestSpec = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('truth-table'), rows: z.array(TruthRow).min(1).max(65_536) }),
  /** Combinational, exhaustive over every input combination, compared with a reference (inputs <= 16 bits total). */
  z.object({
    kind: z.literal('exhaustive'),
    inputs: z.array(z.string()).min(1),
    outputs: z.array(z.string()).min(1),
    /** Name of a reference function in sim-logic's checker registry (e.g. 'adder8'). */
    reference: z.string(),
  }),
  /** Random property test: N random input vectors compared with a reference. Seeded. */
  z.object({
    kind: z.literal('random'),
    inputs: z.array(z.string()).min(1),
    outputs: z.array(z.string()).min(1),
    reference: z.string(),
    count: z.number().int().min(1).max(100_000).default(1000),
    seed: z.number().int().default(1),
  }),
  z.object({ kind: z.literal('sequence'), steps: z.array(SequenceStep).min(1).max(100_000) }),
  /**
   * Program run (TOY-03): load `program` (hex bytes) into the ROM labelled `rom`,
   * power on, run up to `maxCycles` full clock cycles or until the output labelled
   * `halt` is 1, then compare labelled outputs.
   */
  z.object({
    kind: z.literal('program'),
    program: z.string().max(100_000),
    /**
     * Bytes per ROM word: 1 (default) for Toy-8, 4 for RV32 boards (Phase 5). Program
     * bytes are packed little-endian into words of the ROM labelled `rom`.
     */
    wordBytes: z.union([z.literal(1), z.literal(4)]).optional(),
    rom: z.string().default('ROM'),
    halt: z.string().default('HALT'),
    maxCycles: z.number().int().min(1).max(10_000_000),
    set: Values.optional(),
    expect: Values,
  }),
  /**
   * Code levels (Phase 6+): assemble the player's RV32 source, load it at the
   * RAM base, run it on the emulator, compare. The program ends at `ebreak`, or
   * `ecall` with a7 = 93 (exit, code in a0); running past `maxSteps` fails
   * with a message suggesting an exit (E-SIM-10). One case per test.
   */
  z.object({
    kind: z.literal('riscv'),
    /** Short name shown in the test strip, e.g. "sum of 1..10". */
    name: z.string().max(80).optional(),
    setup: z
      .object({
        /** Registers by ABI name (a0, sp, …) or xN, set before running. */
        regs: z.record(z.string(), Num).optional(),
        /** Bytes poked into memory before running: hex string at an address. */
        memory: z.array(z.object({ addr: Num, hex: z.string().max(100_000) })).max(64).optional(),
        /** Disk contents before running (needs the 'disk' device): hex bytes from a 512-byte sector. */
        disk: z.array(z.object({ sector: Num, hex: z.string().max(2_000_000) })).max(256).optional(),
      })
      .optional(),
    /** Text the program reads from the UART (and keyboard device). */
    input: z.string().max(100_000).optional(),
    expect: z.object({
      regs: z.record(z.string(), Num).optional(),
      memory: z.array(z.object({ addr: Num, hex: z.string().max(100_000) })).max(64).optional(),
      /** Exact UART output. */
      uart: z.string().max(100_000).optional(),
      exitCode: Num.optional(),
      /** SHA-256 (hex) of the 64,000 framebuffer bytes at exit. */
      framebufferSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    }),
    maxSteps: z.number().int().min(1).max(200_000_000).default(5_000_000),
  }),
  /**
   * Track 2 (Neuron to LLM): run the player's JavaScript module in the sandbox
   * (no network, time limit — ASM-05), call `entry(...args)` and compare.
   * - expect: deep equality; numbers within `tolerance` (E-ML-02: never exact
   *   for floats). Tensors compare by shape + values (`{shape, data}` JSON).
   * - metric: the result must be an object; result[metric.name] within [min, max]
   *   (training levels: e.g. accuracy >= 0.95, loss <= 0.1).
   */
  z.object({
    kind: z.literal('js'),
    name: z.string().max(80).optional(),
    entry: z.string().min(1).max(64),
    args: z.array(z.unknown()).max(16).default([]),
    expect: z.unknown().optional(),
    tolerance: z.number().min(0).max(1).default(1e-6),
    metric: z.object({ name: z.string().max(40), min: z.number().optional(), max: z.number().optional() }).optional(),
    /** Seed passed to the sandbox's seeded RNG (Math.random is replaced). */
    seed: z.number().int().default(1),
    timeoutMs: z.number().int().min(100).max(600_000).default(10_000),
  }),
]);
export type TestSpec = z.infer<typeof TestSpec>;

/** Library modules a Track 2 level may unlock for import in the player's code. */
export const JS_MODULES = ['tensor', 'autograd', 'nn', 'optim', 'data', 'tokenizer', 'plot'] as const;
export const JsModule = z.enum(JS_MODULES);
export type JsModule = z.infer<typeof JsModule>;

/** What a Track 2 level gives the player. */
export const JsSetup = z.object({
  /** The player's file (main.js): an ES module whose exports the tests call. */
  starter: z.string().max(100_000).default(''),
  /** Modules importable as `import { … } from 'tensor'` etc.; grows as levels unlock them. */
  modules: z.array(JsModule).default([]),
  /** Datasets the level provides through the 'data' module, by id (see content/datasets). */
  datasets: z.array(z.string().max(64)).max(8).default([]),
  /** Read-only helper files shown as tabs and importable by name ('./helpers.js'). */
  library: z.array(z.object({ name: z.string().max(64), text: z.string().max(200_000) })).max(8).default([]),
  /** Show the training panel (loss curve, Train/Stop) for levels that train. */
  training: z.boolean().default(false),
});
export type JsSetup = z.infer<typeof JsSetup>;

export const DEVICES = ['uart', 'keyboard', 'timer', 'framebuffer', 'disk'] as const;
export const Device = z.enum(DEVICES);
export type Device = z.infer<typeof Device>;

/** What a code level gives the player (Phase 6+). */
export const CodeSetup = z.object({
  /**
   * 'rv32-asm': the player's file is main.s. 'c': main.c, compiled by
   * @build-a-computer/cc and linked with @build-a-computer/libc (crt0 calls
   * main; its return value is the exit code).
   */
  language: z.enum(['rv32-asm', 'c']),
  /** Text the editor starts with. */
  starter: z.string().max(100_000).default(''),
  /** Devices shown as panels; the machine always has the full memory map. */
  devices: z.array(Device).default(['uart']),
  /** RAM size in bytes (multiple of 4 KiB). */
  ramSize: z.number().int().min(4096).max(64 * 1024 * 1024).default(1024 * 1024),
  /**
   * Read-only files the level provides, built with the player's source: `.s`
   * files are assembled, `.c` files compiled (C levels and C libraries only).
   */
  library: z.array(z.object({ name: z.string().max(64), text: z.string().max(200_000) })).max(16).default([]),
  /** C levels: link libc unless false. OS levels set false and bring their own runtime. */
  libc: z.boolean().optional(),
});
export type CodeSetup = z.infer<typeof CodeSetup>;

export const ResourceTag = z.enum(['start-here', 'video', 'article', 'book', 'spec', 'course']);

export const Resource = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(200),
  tags: z.array(ResourceTag).default([]),
  lang: z.string().min(2).max(8).default('en'),
  differsNote: z.string().max(200).optional(),
  /** Set only by an agent or person who fetched the URL (E-RES-05). */
  verifiedTitle: z.string().min(1),
  verifiedAt: z.string().datetime(),
});
export type Resource = z.infer<typeof Resource>;

export const Level = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(64),
  version: z.number().int().min(1),
  track: z.enum(['nand-to-os', 'neuron-to-llm', 'sandbox']),
  phase: z.number().int().min(0),
  order: z.number().int().min(0),
  title: z.string().min(1).max(80),
  /** Short goal shown in the level panel. */
  goal: z.string().min(1).max(600),
  tutorial: z.string().max(20_000).default(''),
  hints: z.array(z.string().max(1000)).max(10).default([]),
  afterword: z.string().max(4000).default(''),
  /** Parts the player may place. Locked starter parts may use others. */
  palette: z.array(PartType),
  /** Locked inputs and outputs placed when the level opens. */
  starter: Board,
  tests: z.array(TestSpec).max(16).default([]),
  requires: z.array(z.string()).default([]),
  resources: z.array(Resource).max(4).default([]),
  /** Volatile state at power on (E-SIM-07). */
  power: z.enum(['zero', 'random']).default('zero'),
  /** 'board' levels wire parts; 'code' levels write assembly or C (Phase 6+); 'js' levels are Track 2. */
  mode: z.enum(['board', 'code', 'js']).default('board'),
  /** Required when mode is 'code'. */
  code: CodeSetup.optional(),
  /** Required when mode is 'js'. */
  js: JsSetup.optional(),
  /** Optional level: may be skipped without blocking later levels. */
  optional: z.boolean().default(false),
  draft: z.boolean().default(false),
});
export type Level = z.infer<typeof Level>;
