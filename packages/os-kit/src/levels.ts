/**
 * What each Phase 9 level is made of. Every level gives the player one piece
 * of the operating system (their `main.c` or `main.s`); the level's library
 * files are the rest of the kernel at that stage (the reference kernel,
 * specialized: see ./specialize), plus the programs the tests run. Disk
 * images for the tests come from the disk image builder (./disk).
 *
 * Two shapes of level:
 * - Kernel levels (trap … fs): the image the machine starts is the kernel;
 *   the player's file is one kernel source file.
 * - Program levels (shell, game): the image the machine starts is the
 *   player's *program* plus a bootloader; the bootloader loads the full
 *   reference kernel from the disk, and the kernel runs the program in user
 *   mode (docs/os.md, "Booting a program level").
 * The bootloader level is neither: the player writes the bootloader itself.
 */

import { type LinkResult } from '@build-a-computer/asm';
import { type SourceFile, buildImage, exeFile, symbol } from './build';
import { type DiskFile, buildDisk } from './disk';
import { type Feature, specialize } from './specialize';
import { source } from './sources';

export type { SourceFile } from './build';

/** Where program levels' bootloader puts the kernel (and where it is linked). */
export const KERNEL_LOAD = 0x8020_0000;
/** Where programs are linked and loaded (kernel.h USER_BASE). */
export const USER_BASE = 0x0001_0000;
/** RAM for every Phase 9 level (kernel.h RAM_END - RAM_BASE). */
export const OS_RAM_SIZE = 4 * 1024 * 1024;

export const LEVEL_KEYS = [
  'boot',
  'trap',
  'syscall',
  'proc',
  'timer',
  'vm',
  'alloc',
  'fs',
  'shell',
  'game',
] as const;
export type LevelKey = (typeof LEVEL_KEYS)[number];

const FULL: Feature[] = ['SYSCALL', 'PROC', 'TIMER', 'VM', 'FS'];

/** Kernel features at each level. */
export const STAGE: Record<LevelKey, Feature[]> = {
  boot: [],
  trap: [],
  syscall: ['SYSCALL'],
  proc: ['SYSCALL', 'PROC'],
  timer: ['SYSCALL', 'PROC', 'TIMER'],
  vm: ['SYSCALL', 'PROC', 'TIMER', 'VM'],
  alloc: ['SYSCALL', 'PROC', 'TIMER', 'VM'],
  fs: FULL,
  shell: FULL,
  game: FULL,
};

/** Kernel source files in link order (start.s first: its _start is the entry). */
export const KERNEL_ORDER = [
  'start.s', 'trapvec.s', 'console.c', 'trap.c', 'syscall.c', 'uaccess.c', 'proc.c',
  'timer.c', 'kalloc.c', 'vm.c', 'exec.c', 'disk.c', 'fs.c', 'file.c', 'kmain.c',
] as const; // prettier-ignore

/** The feature a kernel file belongs to (files without one are always there). */
const FILE_FEATURE: Partial<Record<string, Feature>> = {
  'syscall.c': 'SYSCALL',
  'uaccess.c': 'SYSCALL',
  'proc.c': 'PROC',
  'timer.c': 'TIMER',
  'kalloc.c': 'VM',
  'vm.c': 'VM',
  'exec.c': 'VM',
  'disk.c': 'FS',
  'fs.c': 'FS',
  'file.c': 'FS',
};

/** The player's file at each level: a path in this package. */
export const PLAYER_FILE: Record<LevelKey, string> = {
  boot: 'boot/boot.c',
  trap: 'kernel/trapvec.s',
  syscall: 'kernel/syscall.c',
  proc: 'kernel/proc.c',
  timer: 'kernel/timer.c',
  vm: 'kernel/vm.c',
  alloc: 'kernel/kalloc.c',
  fs: 'kernel/fs.c',
  shell: 'levels/shell/sh.c',
  game: 'levels/game/snake.c',
};

const file = (path: string, features: readonly Feature[] = [], name?: string): SourceFile => ({
  name: name ?? path.slice(path.lastIndexOf('/') + 1),
  text: specialize(source(path), features),
});

/** The kernel at a stage: kernel.h, the enabled files (minus `omit`), then end.s. */
export function kernelFiles(features: readonly Feature[], omit?: string): SourceFile[] {
  const out: SourceFile[] = [file('kernel/kernel.h', features)];
  for (const name of KERNEL_ORDER) {
    const need = FILE_FEATURE[name];
    if (need && !features.includes(need)) continue;
    if (name === omit) continue;
    out.push(file(`kernel/${name}`, features));
  }
  return out;
}

const END = (): SourceFile => file('kernel/end.s');

/** The user library a program links with: ucrt.s first (its _ustart is the entry). */
export function userLibrary(): SourceFile[] {
  return [file('user/user.h'), file('user/ucrt.s'), file('user/usys.s'), file('user/ulib.c')];
}

/** Options for building kits (tests may swap the C compiler). */
export interface KitOptions {
  /** Build files at a base address; defaults to buildImage (our cc + asm). */
  build?: (files: readonly SourceFile[], base: number) => LinkResult;
}

/** A user program file (header + image, linked at USER_BASE) from C sources. */
export function buildProgramFile(paths: readonly string[], opts: KitOptions = {}): Uint8Array {
  const build = opts.build ?? buildImage;
  return exeFile(
    build([...userLibrary(), ...paths.map((p) => file(p)), file('user/uend.s')], USER_BASE),
  );
}

/**
 * Kernel data symbols the debugger's OS panels read (process table, free
 * list, superblock): program levels' kits record their addresses in the disk
 * kernel as facts `kernel.<name>`, since that kernel's symbols never reach the
 * player's build.
 */
export const KERNEL_INSPECT_SYMBOLS = [
  '_start', 'procs', 'current', 'freelist', 'nfree', 'mem_start', 'mem_end', 'kernel_end', 'sb', 'ticks',
] as const; // prettier-ignore

/** The full reference kernel linked at KERNEL_LOAD, for program levels' disks. */
export function buildDiskKernel(opts: KitOptions = {}): {
  image: Uint8Array;
  load: number;
  entry: number;
  /** Addresses of KERNEL_INSPECT_SYMBOLS (those present). */
  symbols: Record<string, number>;
} {
  const build = opts.build ?? buildImage;
  const linked = build([...kernelFiles(FULL), END()], KERNEL_LOAD);
  // The loader zeroes nothing: carry the bss as zero bytes in the image.
  const image = new Uint8Array(linked.end - linked.base);
  image.set(linked.image);
  const symbols: Record<string, number> = {};
  for (const name of KERNEL_INSPECT_SYMBOLS) {
    const s = linked.symbols.find((x) => x.name === name);
    if (s) symbols[name] = s.address >>> 0;
  }
  return { image, load: KERNEL_LOAD, entry: symbol(linked, '_start'), symbols };
}

/** Programs built into the kernel (no file system yet), as programs.s. */
export function programsAsm(programs: readonly { name: string; data: Uint8Array }[]): string {
  const lines = [
    '# programs.s: the programs built into the kernel at this level (generated:',
    '# each one is a program file, compiled and linked at USER_BASE).',
    '    .section .rodata',
    '    .align 2',
    '    .globl programs',
    'programs:                  # struct progent { char *name; uchar *image; uint size; }',
  ];
  programs.forEach((p, i) =>
    lines.push(`    .word prog_name${i}, prog_image${i}, ${p.data.length}`),
  );
  lines.push('    .word 0, 0, 0');
  programs.forEach((p, i) => {
    lines.push(`prog_name${i}:`, `    .asciz "${p.name}"`, '    .align 2', `prog_image${i}:`);
    let k = 0;
    while (k < p.data.length) {
      let z = k;
      while (z < p.data.length && p.data[z] === 0) z++;
      if (z - k >= 32) {
        lines.push(`    .zero ${z - k}`);
        k = z;
        continue;
      }
      const row = p.data.subarray(k, Math.min(k + 16, p.data.length));
      lines.push(
        '    .byte ' + Array.from(row, (b) => `0x${b.toString(16).padStart(2, '0')}`).join(', '),
      );
      k += row.length;
    }
  });
  return lines.join('\n') + '\n';
}

/** Everything one level needs. */
export interface LevelKit {
  key: LevelKey;
  language: 'c' | 'rv32-asm';
  /** The player's file as the reference has it (the level's solution). */
  solution: string;
  /** What the editor starts with: the same file with the bodies left to write. */
  starter: string;
  /** Read-only files, in link order (after the player's file). */
  library: SourceFile[];
  /** Disk images for the tests, by name. */
  disks: Record<string, Uint8Array>;
  /** Sizes of the files on the disks (for expected `ls` output), by file name. */
  sizes: Record<string, number>;
  /** Numbers the tests' expected output depends on (kernel sizes, page counts). */
  facts: Record<string, number>;
}

/** Text files on the file-system disks. */
export const README = 'Welcome to your own operating system!\nThis file lives on the disk.\n';
/** A file big enough to need the indirect sector (more than 12 sectors). */
export const BIG_TEXT = Array.from(
  { length: 140 },
  (_, i) => `${String(i + 1).padStart(3, '0')}: the quick brown fox jumps over the lazy dog\n`,
).join('');

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Build one level's kit. */
export function buildKit(key: LevelKey, opts: KitOptions = {}): LevelKit {
  const build = opts.build ?? buildImage;
  const features = STAGE[key];
  const player = PLAYER_FILE[key];
  const playerName = player.slice(player.lastIndexOf('/') + 1);
  const solution = specialize(source(player), features);
  const language = player.endsWith('.s') ? 'rv32-asm' : 'c';
  const starter = specialize(
    source(`levels/${key}/starter.${player.endsWith('.s') ? 's' : 'c'}`),
    features,
  );
  const disks: Record<string, Uint8Array> = {};
  const sizes: Record<string, number> = {};
  const facts: Record<string, number> = {};
  const prog = (p: string): Uint8Array => buildProgramFile([p], { build });
  const lvl = (name: string): SourceFile => file(`levels/${key}/${name}`, features);
  let library: SourceFile[];

  switch (key) {
    case 'boot': {
      library = [file('boot/boot.h'), file('boot/bootlib.c'), file('boot/bootlib.s')];
      const kernel = (name: string, load: number) => {
        const l = build([file(`levels/boot/${name}.s`)], load);
        const image = new Uint8Array(l.end - l.base);
        image.set(l.image);
        return { image, load, entry: symbol(l, '_start') };
      };
      const add = (
        name: string,
        k: ReturnType<typeof kernel>,
        spec: { rawStart?: number; badChecksum?: boolean } = {},
      ) => {
        disks[name] = buildDisk({ boot: k, ...spec });
        facts[`${name}.size`] = k.image.length;
        facts[`${name}.load`] = k.load;
        facts[`${name}.entry`] = k.entry;
      };
      add('hello', kernel('hello', KERNEL_LOAD));
      add('long', kernel('long', 0x8030_0000));
      add('entry', kernel('entry', KERNEL_LOAD));
      add('far', kernel('hello', 0x8010_0000), { rawStart: 37 });
      add('corrupt', kernel('long', KERNEL_LOAD), { badChecksum: true });
      disks['blank'] = new Uint8Array(0);
      break;
    }
    case 'trap':
      library = [...kernelFiles(features, playerName), lvl('programs.c'), lvl('user.s'), END()];
      break;
    case 'syscall':
    case 'proc':
    case 'timer':
      library = [
        ...kernelFiles(features, playerName),
        lvl('programs.c'),
        file('user/user.h'),
        lvl('user.c'),
        file('user/usys.s'),
        file('user/ulib.c'),
        END(),
      ];
      break;
    case 'vm':
    case 'alloc': {
      const names =
        key === 'vm'
          ? ['hello', 'same', 'nullread', 'rotext', 'peek', 'badptr']
          : ['leaks', 'child', 'zero', 'dirty', 'clean', 'oom', 'hog', 'heap'];
      const programs = names.map((n) => ({ name: n, data: prog(`levels/${key}/${n}.c`) }));
      for (const p of programs) {
        sizes[p.name] = p.data.length;
        // Pages a process of this program holds: the image, 2 stack pages,
        // the stack's guard page and 3 page tables (root, code's leaf, stack's leaf).
        const memsz = new DataView(p.data.buffer, p.data.byteOffset).getUint32(16, true);
        facts[`${p.name}.pages`] = Math.ceil(memsz / 4096) + 3 + 3;
      }
      library = [
        ...kernelFiles(features, playerName),
        lvl('programs.c'),
        { name: 'programs.s', text: programsAsm(programs) },
        END(),
      ];
      break;
    }
    case 'fs': {
      library = [...kernelFiles(features, playerName), END()];
      const hello = prog('user/hello.c');
      const files = (init: string, ...more: [string, Uint8Array][]): DiskFile[] => [
        { name: 'init', data: prog(`levels/fs/${init}.c`) },
        ...more.map(([name, data]) => ({ name, data })),
      ];
      const disk = (name: string, f: DiskFile[]) => {
        disks[name] = buildDisk({ files: f });
        for (const x of f) sizes[`${name}/${x.name}`] = x.data.length;
      };
      disk(
        'ls',
        files('fsls', ['readme.txt', text(README)], ['hello', hello], ['big.txt', text(BIG_TEXT)]),
      );
      disk('cat', files('fscat', ['readme.txt', text(README)], ['big.txt', text(BIG_TEXT)]));
      disk('run', files('fsrun', ['hello', hello], ['readme.txt', text(README)]));
      disk(
        'edges',
        files(
          'fsedge',
          ['readme.txt', text(README)],
          ['empty', new Uint8Array(0)],
          ['twelve_chars', text('12\n')],
        ),
      );
      disks['blank'] = new Uint8Array(0);
      break;
    }
    case 'shell':
    case 'game': {
      library = [
        file('boot/boot.h'),
        file('boot/bootlib.c'),
        file('boot/bootlib.s'),
        file('boot/boot.c', ['USERBOOT'], 'bootmain.c'),
        file('boot/bootstart.s'),
        ...userLibrary(),
        file('user/uend.s'),
      ];
      const kernel = buildDiskKernel({ build });
      const f: DiskFile[] =
        key === 'shell'
          ? [
              { name: 'ls', data: prog('user/ls.c') },
              { name: 'cat', data: prog('user/cat.c') },
              { name: 'echo', data: prog('user/echo.c') },
              { name: 'hello', data: prog('user/hello.c') },
              { name: 'readme.txt', data: text(README) },
            ]
          : [{ name: 'readme.txt', data: text(README) }];
      disks['os'] = buildDisk({ boot: kernel, files: f });
      for (const x of f) sizes[x.name] = x.data.length;
      sizes['kernel'] = kernel.image.length;
      for (const [name, addr] of Object.entries(kernel.symbols)) facts[`kernel.${name}`] = addr;
      break;
    }
  }
  return { key, language, solution, starter, library, disks, sizes, facts };
}
