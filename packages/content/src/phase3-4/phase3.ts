import type { Level, Part, PartType } from '@ground-up/schema';
import { defineLevel, grow, lamp, sw } from '../define';
import { AFTER_PHASE2, PHASE2_LAST_ID, check, cycle, ticks } from './common';

/**
 * Phase 3, Memory and time: the clock, SR latch from NAND, D latch, D
 * flip-flop, register with enable, 8-bit register, counter, register file
 * (4 by 8), RAM (16 by 8), ROM. Unlocks: clock, dff, register, counter, ram, rom.
 * DRAFT text (owner approves curriculum text). CNT-05.
 */

/** The global clock, locked into the starter of every clocked level. */
export const clockPart = (x = -14, y = -10): Part => ({ id: 'CLK', type: 'clock', x, y, rot: 0, flip: false, label: 'CLK', locked: true });

const P_CLOCK = grow(AFTER_PHASE2, 'clock');
const P_DFF = grow(P_CLOCK, 'dff');
const P_REG = grow(P_DFF, 'register');
const P_COUNTER = grow(P_REG, 'counter');
const P_RAM = grow(P_COUNTER, 'ram');
/** Everything Phase 3 unlocks (rom comes from the last level). */
export const P3_ALL: PartType[] = grow(P_RAM, 'rom');

const base = { track: 'nand-to-os', phase: 3 } as const;

/** The data in the ROM level: "NAND" in ASCII. */
export const ROM_LEVEL_DATA = [0x4e, 0x41, 0x4e, 0x44];

export const PHASE3: Level[] = [
  defineLevel({
    ...base,
    id: 'the-clock',
    order: 1,
    title: 'The clock',
    goal: 'Place a clock. TICK must follow the clock; TOCK must always be its opposite.',
    tutorial:
      'Until now every circuit answered at once: change an input, the output follows. Memory needs something new: a sense of "before" and "after". ' +
      'A clock is a signal that flips between 0 and 1 forever. Each flip is a tick; two ticks (low to high, then back) are one cycle.\n\n' +
      'Every part that remembers will act on one moment only: the rising edge, when the clock goes from 0 to 1.',
    hints: ['The clock is in the I/O section of the parts list.', 'TOCK is the clock through a NOT gate.'],
    afterword: 'The clock is unlocked. Every memory level from now on has one, locked in place, labelled CLK.',
    palette: P_CLOCK,
    starter: { parts: [lamp('TICK', 14, -2), lamp('TOCK', 14, 2)], wires: [] },
    tests: [
      {
        kind: 'sequence',
        steps: [
          check(undefined, { TICK: 0, TOCK: 1 }),
          ticks(1, undefined, { TICK: 1, TOCK: 0 }),
          ticks(1, undefined, { TICK: 0, TOCK: 1 }),
          ticks(3, undefined, { TICK: 1, TOCK: 0 }),
          ticks(2, undefined, { TICK: 1, TOCK: 0 }),
          ticks(1, undefined, { TICK: 0, TOCK: 1 }),
        ],
      },
    ],
    requires: [PHASE2_LAST_ID],
  }),
  defineLevel({
    ...base,
    id: 'sr-latch',
    order: 2,
    title: 'SR latch from NAND',
    goal: 'S (set) turns Q on, R (reset) turns Q off. With both off, Q keeps its last value. S and R are never on together.',
    tutorial:
      'A gate whose output feeds back into its own inputs can hold a value. Two NAND gates, each feeding the other, form a latch: the simplest memory there is.\n\n' +
      'The NAND latch reacts to 0s, not 1s. Its inputs rest at 1 and a 0 sets or resets it. Your S and R rest at 0, so flip them first.\n\n' +
      'The simulator lets loops settle. When the power comes on, a latch picks a side on its own, so the tests never read Q before setting or resetting it.',
    hints: [
      'Cross-couple two NANDs: each one\'s output goes to one input of the other.',
      'Q = NAND(NOT S, Q̄) and Q̄ = NAND(NOT R, Q).',
      'Loops are allowed here. That is the whole point.',
    ],
    afterword: 'You built memory out of two gates and a loop. Every register, RAM chip and CPU state you build from now on is this idea, refined.',
    palette: P_CLOCK,
    starter: { parts: [sw('S', -14, -2), sw('R', -14, 2), lamp('Q', 14, 0)], wires: [] },
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: [
          check({ S: 1, R: 0 }, { Q: 1 }),
          check({ S: 0, R: 0 }, { Q: 1 }),
          check({ S: 0, R: 1 }, { Q: 0 }),
          check({ S: 0, R: 0 }, { Q: 0 }),
          check({ S: 1, R: 0 }, { Q: 1 }),
          check({ S: 1, R: 0 }, { Q: 1 }),
          check({ S: 0, R: 0 }, { Q: 1 }),
          check({ S: 0, R: 1 }, { Q: 0 }),
          check({ S: 0, R: 1 }, { Q: 0 }),
          check({ S: 0, R: 0 }, { Q: 0 }),
        ],
      },
    ],
    requires: ['the-clock'],
  }),
  defineLevel({
    ...base,
    id: 'd-latch',
    order: 3,
    title: 'D latch',
    goal: 'While E is on, Q follows D. While E is off, Q holds the value D had when E turned off.',
    tutorial:
      'The SR latch has an awkward rule: S and R must never be on together. A D latch removes it: one data input D, and an enable E that says when to listen.\n\n' +
      'Build set and reset from D and E so that they can never both be active.',
    hints: ['Set = D AND E. Reset = NOT D AND E.', 'Feed those into your SR latch.', 'With NANDs only: NAND(D, E) is already the active-low set.'],
    afterword: 'A latch is "transparent" while enabled: changes on D flow straight through. The next level fixes that.',
    palette: P_CLOCK,
    starter: { parts: [sw('D', -14, -2), sw('E', -14, 2), lamp('Q', 14, 0)], wires: [] },
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: [
          check({ E: 1, D: 1 }, { Q: 1 }),
          check({ D: 0 }, { Q: 0 }),
          check({ D: 1 }, { Q: 1 }),
          check({ E: 0 }, { Q: 1 }),
          check({ D: 0 }, { Q: 1 }),
          check({ D: 1 }, { Q: 1 }),
          check({ D: 0, E: 1 }, { Q: 0 }),
          check({ E: 0 }, { Q: 0 }),
          check({ D: 1 }, { Q: 0 }),
        ],
      },
    ],
    requires: ['sr-latch'],
  }),
  defineLevel({
    ...base,
    id: 'd-flip-flop',
    order: 4,
    title: 'D flip-flop',
    goal: 'Q takes the value of D at the rising edge of the clock (0 to 1), and holds it until the next rising edge.',
    tutorial:
      'A flip-flop listens for one instant only: the rising edge. That makes circuits predictable. Everything that remembers changes at the same moment, ' +
      'and between edges the gates have time to settle.\n\n' +
      'The classic design is two D latches in a row, master and slave, enabled by opposite clock levels.',
    hints: [
      'The master latch is enabled while CLK is 0; the slave while CLK is 1.',
      'Master D = D. Slave D = master Q. Q = slave Q.',
      'When the clock rises, the master closes and the slave shows what the master caught.',
    ],
    afterword: 'The D flip-flop is now a block (dff). It is the atom of every register and counter ahead.',
    palette: P_CLOCK,
    starter: { parts: [clockPart(), sw('D', -14, 0), lamp('Q', 14, 0)], wires: [] },
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: [
          ticks(1, { D: 1 }, { Q: 1 }), // rising edge
          ticks(1, undefined, { Q: 1 }), // falling edge
          ticks(0, { D: 0 }, { Q: 1 }), // clock low: no change
          ticks(1, undefined, { Q: 0 }), // rising edge
          ticks(0, { D: 1 }, { Q: 0 }), // clock high: not transparent
          ticks(1, undefined, { Q: 0 }), // falling edge: no change
          ticks(1, undefined, { Q: 1 }), // rising edge
          ticks(2, { D: 0 }, { Q: 0 }),
          ticks(2, undefined, { Q: 0 }),
        ],
      },
    ],
    requires: ['d-latch'],
  }),
  defineLevel({
    ...base,
    id: 'register-enable',
    order: 5,
    title: 'Register with enable',
    goal: 'At each rising edge, Q takes D if LOAD is on; otherwise Q keeps its value.',
    tutorial:
      'A flip-flop takes a new value every cycle. A register should only change when told to. ' +
      'The trick is not to stop the clock (never gate the clock) but to feed the flip-flop its own output when LOAD is off.',
    hints: ['A multiplexer chooses between the old value Q and the new value D.', 'mux: a = Q, b = D, sel = LOAD, into the dff.'],
    afterword: 'This one-bit register is the pattern for everything with a "load" or "write enable" pin.',
    palette: P_DFF,
    starter: { parts: [clockPart(), sw('D', -14, -2), sw('LOAD', -14, 2), lamp('Q', 14, 0)], wires: [] },
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: [
          cycle({ D: 1, LOAD: 1 }, { Q: 1 }),
          cycle({ D: 0, LOAD: 0 }, { Q: 1 }),
          cycle(undefined, { Q: 1 }),
          cycle({ D: 0, LOAD: 1 }, { Q: 0 }),
          cycle({ D: 1, LOAD: 0 }, { Q: 0 }),
          check({ D: 1, LOAD: 1 }, { Q: 0 }),
          cycle(undefined, { Q: 1 }),
          cycle({ D: 0, LOAD: 0 }, { Q: 1 }, 3),
        ],
      },
    ],
    requires: ['d-flip-flop'],
  }),
  defineLevel({
    ...base,
    id: 'register-8bit',
    order: 6,
    title: '8-bit register',
    goal: 'At each rising edge, the 8-bit Q takes the 8-bit D if LOAD is on; otherwise it keeps its value.',
    tutorial: 'Eight one-bit registers side by side, sharing LOAD and the clock. Split the byte into bits, store each, join them back.',
    hints: [
      'A multiplexer can be 8 bits wide: choose the whole byte at once, then split it into flip-flops.',
      'Splitter → 8 flip-flops → joiner.',
    ],
    afterword: 'The register is now a block with any width up to 32. Your CPU will have six of them.',
    palette: P_DFF,
    starter: { parts: [clockPart(), sw('D', -14, -2, 8), sw('LOAD', -14, 2), lamp('Q', 14, 0, 8, 'hex')], wires: [] },
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: [
          cycle({ D: 0xa5, LOAD: 1 }, { Q: 0xa5 }),
          cycle({ D: 0x3c, LOAD: 0 }, { Q: 0xa5 }),
          cycle({ D: 0x3c, LOAD: 1 }, { Q: 0x3c }),
          cycle({ D: 0xff, LOAD: 1 }, { Q: 0xff }),
          check({ D: 0x00, LOAD: 1 }, { Q: 0xff }),
          cycle(undefined, { Q: 0x00 }),
          cycle({ D: 0x81, LOAD: 0 }, { Q: 0x00 }, 4),
          cycle({ D: 0x81, LOAD: 1 }, { Q: 0x81 }),
        ],
      },
    ],
    requires: ['register-enable'],
  }),
  defineLevel({
    ...base,
    id: 'counter-8bit',
    order: 7,
    title: 'Counter',
    goal: 'At each rising edge: if LOAD, Q takes D; else if EN, Q adds 1 (255 wraps to 0); else Q holds.',
    tutorial:
      'A counter is a register that feeds itself plus one. Your CPU will use one to remember which instruction comes next: the program counter. ' +
      'LOAD lets a jump set it to any value.',
    hints: ['Adder: Q + 0 with carry in 1 is Q + 1.', 'Two multiplexers decide the next value: Q or Q + 1 by EN, then that or D by LOAD.', 'Keep the register\'s own LOAD on.'],
    afterword: 'The counter is now a block: d, load, en, clk → q. Next: many registers you can pick by number.',
    palette: P_REG,
    starter: {
      parts: [clockPart(), sw('D', -14, -4, 8), sw('LOAD', -14, 0), sw('EN', -14, 4), lamp('Q', 14, 0, 8, 'dec')],
      wires: [],
    },
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: [
          cycle({ D: 250, LOAD: 1, EN: 0 }, { Q: 250 }),
          cycle({ LOAD: 0, EN: 1 }, { Q: 251 }),
          cycle(undefined, { Q: 255 }, 4),
          cycle(undefined, { Q: 0 }),
          cycle(undefined, { Q: 1 }),
          cycle({ EN: 0 }, { Q: 1 }, 3),
          cycle({ D: 7, LOAD: 1, EN: 1 }, { Q: 7 }),
          cycle({ LOAD: 0 }, { Q: 8 }),
          check({ D: 100, LOAD: 1 }, { Q: 8 }),
          cycle(undefined, { Q: 100 }),
        ],
      },
    ],
    requires: ['register-8bit'],
  }),
  defineLevel({
    ...base,
    id: 'register-file',
    order: 8,
    title: 'Register file (4 by 8)',
    goal:
      'Four 8-bit registers R0..R3. At a rising edge with WE on, register number W takes D. ' +
      'A always shows register number RA and B shows register number RB, without waiting for the clock.',
    tutorial:
      'A CPU keeps the numbers it is working on in a few fast registers. Instructions name them by number: "add R1 to R2". ' +
      'A register file has one write port (which register to write, chosen by a decoder) and two read ports (which registers to show, chosen by multiplexers).',
    hints: [
      'A 2-to-4 decoder turns W into four lines; AND each with WE to get each register\'s LOAD.',
      'A 4-to-1 multiplexer is three 2-to-1 multiplexers. Split RA into its two bits.',
      'Every register gets the same D.',
    ],
    afterword: 'This is exactly the register file of the Toy-8 CPU you will build in Phase 4.',
    palette: P_COUNTER,
    starter: {
      parts: [
        clockPart(),
        sw('D', -16, -8, 8),
        sw('W', -16, -4, 2),
        sw('WE', -16, 0),
        sw('RA', -16, 4, 2),
        sw('RB', -16, 8, 2),
        lamp('A', 16, -2, 8, 'hex'),
        lamp('B', 16, 2, 8, 'hex'),
      ],
      wires: [],
    },
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: [
          cycle({ D: 0x11, W: 0, WE: 1, RA: 0, RB: 0 }, { A: 0x11, B: 0x11 }),
          cycle({ D: 0x22, W: 1 }, { A: 0x11 }),
          cycle({ D: 0x33, W: 2 }),
          cycle({ D: 0x44, W: 3 }),
          check({ WE: 0, RA: 1, RB: 2 }, { A: 0x22, B: 0x33 }),
          check({ RA: 3, RB: 0 }, { A: 0x44, B: 0x11 }),
          check({ RA: 2, RB: 2 }, { A: 0x33, B: 0x33 }),
          cycle({ D: 0xee, W: 2, WE: 0 }, { A: 0x33, B: 0x33 }),
          check({ D: 0xab, W: 1, WE: 1, RA: 1, RB: 3 }, { A: 0x22, B: 0x44 }),
          cycle(undefined, { A: 0xab, B: 0x44 }),
          check({ WE: 0, RA: 0, RB: 2 }, { A: 0x11, B: 0x33 }),
        ],
      },
    ],
    requires: ['counter-8bit'],
  }),
  defineLevel({
    ...base,
    id: 'ram-16x8',
    order: 9,
    title: 'RAM (16 by 8)',
    goal: 'Sixteen 8-bit words. Q always shows the word at ADDR. At a rising edge with WE on, the word at ADDR takes D.',
    tutorial:
      'Random access memory is a register file with one port and many more registers. The address picks the word for both reading and writing.\n\n' +
      'Real RAM is built from far smaller cells than your registers, but it behaves just like this.',
    hints: [
      'A 4-bit decoder makes 16 select lines. AND each with WE.',
      'Reading is a 16-to-1 multiplexer: four rows of 2-to-1 multiplexers (8, 4, 2, 1).',
      'At power on the words hold junk. The tests write before they read.',
    ],
    afterword: 'RAM is now a block, with up to 16 address bits. The Toy-8 CPU has 256 bytes of it.',
    palette: P_COUNTER,
    starter: { parts: [clockPart(), sw('ADDR', -16, -4, 4), sw('D', -16, 0, 8), sw('WE', -16, 4), lamp('Q', 16, 0, 8, 'hex')], wires: [] },
    power: 'random',
    tests: [
      {
        kind: 'sequence',
        steps: [
          ...Array.from({ length: 16 }, (_, a) => cycle({ ADDR: a, D: (a * 37 + 5) & 0xff, WE: 1 }, { Q: (a * 37 + 5) & 0xff })),
          check({ WE: 0, ADDR: 0 }, { Q: 5 }),
          ...[3, 15, 8, 1].map((a) => check({ ADDR: a }, { Q: (a * 37 + 5) & 0xff })),
          cycle({ ADDR: 6, D: 0x99, WE: 0 }, { Q: (6 * 37 + 5) & 0xff }),
          check({ ADDR: 9, D: 0x77, WE: 1 }, { Q: (9 * 37 + 5) & 0xff }),
          cycle(undefined, { Q: 0x77 }),
          check({ WE: 0, ADDR: 8 }, { Q: (8 * 37 + 5) & 0xff }),
          check({ ADDR: 10 }, { Q: (10 * 37 + 5) & 0xff }),
          check({ ADDR: 9 }, { Q: 0x77 }),
        ],
      },
    ],
    requires: ['register-file'],
  }),
  defineLevel({
    ...base,
    id: 'rom-lookup',
    order: 10,
    title: 'ROM',
    goal: `A four-word read-only memory: Q shows word ADDR of 0x4E, 0x41, 0x4E, 0x44 ("NAND" in ASCII). It must survive a power cycle.`,
    tutorial:
      'Read-only memory holds values that never change and survive power off: the program a computer starts with. ' +
      'A small ROM is just constants and a multiplexer. Real ROMs bake the bits into the chip.',
    hints: ['Four constant blocks, one per word.', 'A 4-to-1 multiplexer picks one by ADDR.'],
    afterword:
      'The ROM block is unlocked. Its contents are typed in as hex bytes, and it keeps them when the power goes off. Phase 4 puts a program in one.',
    palette: P_RAM,
    starter: { parts: [sw('ADDR', -14, 0, 2), lamp('Q', 14, 0, 8, 'hex')], wires: [] },
    power: 'random',
    tests: [
      { kind: 'truth-table', rows: ROM_LEVEL_DATA.map((q, a) => ({ inputs: { ADDR: a }, expect: { Q: q } })) },
      {
        kind: 'sequence',
        steps: [
          check({ ADDR: 1 }, { Q: 0x41 }),
          { power: 'cycle', set: { ADDR: 3 }, ticks: 0, expect: { Q: 0x44 } },
          check({ ADDR: 0 }, { Q: 0x4e }),
        ],
      },
    ],
    requires: ['ram-16x8'],
  }),
];
