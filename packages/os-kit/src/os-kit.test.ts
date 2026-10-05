import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runRiscvTest } from '@build-a-computer/rv-check';
import { Level, type TestSpec } from '@build-a-computer/schema';
import {
  BOOT_MAGIC,
  EXE_MAGIC,
  FS_MAGIC,
  LEVEL_KEYS,
  MAX_FILE_SIZE,
  OS_RAM_SIZE,
  type LevelKit,
  buildDisk,
  buildKit,
  buildProgramFile,
  checksum,
  diskSetup,
  kernelFiles,
  readDisk,
  specialize,
  STAGE,
} from './index';

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const word = (b: Uint8Array, at: number): number =>
  new DataView(b.buffer, b.byteOffset).getUint32(at, true);
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('specialize', () => {
  const src = [
    '#ifndef GUARD_H',
    '#define GUARD_H',
    'a',
    '#ifdef CONFIG_VM',
    'vm',
    '#ifdef CONFIG_FS',
    'vm+fs',
    '#endif',
    '#else',
    'no vm',
    '#endif',
    '#ifndef CONFIG_FS',
    'no fs',
    '#endif',
    '#endif',
  ].join('\n');

  it('keeps enabled branches and removes CONFIG_ lines', () => {
    expect(specialize(src, [])).toBe('#ifndef GUARD_H\n#define GUARD_H\na\nno vm\nno fs\n#endif');
    expect(specialize(src, ['VM'])).toBe('#ifndef GUARD_H\n#define GUARD_H\na\nvm\nno fs\n#endif');
    expect(specialize(src, ['VM', 'FS'])).toBe(
      '#ifndef GUARD_H\n#define GUARD_H\na\nvm\nvm+fs\n#endif',
    );
  });

  it('rejects unbalanced conditionals', () => {
    expect(() => specialize('#ifdef CONFIG_VM\nx', [])).toThrow(/unterminated/);
    expect(() => specialize('x\n#endif', [])).toThrow(/without/);
  });

  it('leaves no CONFIG_ switch in any shipped kernel file', () => {
    for (const key of LEVEL_KEYS)
      for (const f of kernelFiles(STAGE[key]))
        expect(f.text, `${key}: ${f.name}`).not.toMatch(/CONFIG_/);
  });
});

describe('disk image builder (OS-02)', () => {
  const files = [
    { name: 'readme.txt', data: text('hello\n') },
    { name: 'big', data: Uint8Array.from({ length: 9000 }, (_, i) => (i * 7) & 0xff) },
    { name: 'empty', data: new Uint8Array(0) },
  ];
  const boot = {
    image: Uint8Array.from({ length: 1300 }, (_, i) => (i * 13 + 1) & 0xff),
    load: 0x8020_0000,
    entry: 0x8020_0010,
  };

  it('the same inputs always produce the same image hash', () => {
    const a = buildDisk({ boot, files });
    const b = buildDisk({
      boot: { ...boot, image: boot.image.slice() },
      files: files.map((f) => ({ ...f, data: f.data.slice() })),
    });
    expect(sha(a)).toBe(sha(b));
    expect(sha(a)).not.toBe(sha(buildDisk({ boot, files: files.slice(0, 2) })));
  });

  it('writes a boot header the bootloader can follow', () => {
    const d = buildDisk({ boot, rawStart: 5 });
    expect([0, 4, 8, 12, 16, 20, 24].map((o) => word(d, o))).toEqual([
      BOOT_MAGIC,
      boot.load,
      boot.entry,
      5,
      3,
      1300,
      checksum(boot.image),
    ]);
    expect(d.subarray(5 * 512, 5 * 512 + 1300)).toEqual(boot.image);
    expect(word(buildDisk({ boot, badChecksum: true }), 24)).toBe((checksum(boot.image) + 1) >>> 0);
  });

  it('round-trips files, including one that needs the indirect sector, and the kernel as a file', () => {
    const d = buildDisk({ boot, files });
    expect(word(d, 512)).toBe(FS_MAGIC);
    const back = readDisk(d);
    expect(back.map((f) => f.name)).toEqual(['readme.txt', 'big', 'empty', 'kernel']);
    expect(back[1]!.data).toEqual(files[1]!.data);
    expect(back[3]!.data).toEqual(boot.image);
    // The boot header points at the kernel file's (contiguous) sectors.
    const kernelStart = word(d, 12);
    expect(d.subarray(kernelStart * 512, kernelStart * 512 + 1300)).toEqual(boot.image);
  });

  it('rejects bad names, duplicates and files that are too big', () => {
    expect(() =>
      buildDisk({ files: [{ name: 'a name too long', data: new Uint8Array(1) }] }),
    ).toThrow(/bad file name/);
    expect(() =>
      buildDisk({
        files: [
          { name: 'x', data: new Uint8Array(1) },
          { name: 'x', data: new Uint8Array(1) },
        ],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      buildDisk({ files: [{ name: 'huge', data: new Uint8Array(MAX_FILE_SIZE + 1) }] }),
    ).toThrow(/max/);
  });

  it('diskSetup leaves out zero sectors and splits long runs', () => {
    const d = new Uint8Array(512 * 200);
    d[3] = 1;
    d.fill(9, 512 * 10, 512 * 150);
    const s = diskSetup(d, 64);
    expect(s.map((x) => [x.sector, x.hex.length / 1024])).toEqual([
      [0, 1],
      [10, 64],
      [74, 64],
      [138, 12],
    ]);
  });
});

describe('programs', () => {
  it('a program file has the loader header, code ending on a page boundary', () => {
    const f = buildProgramFile(['user/hello.c']);
    expect(word(f, 0)).toBe(EXE_MAGIC);
    expect(word(f, 4)).toBe(0x0001_0000); // entry: _ustart, first in the image
    expect(word(f, 8) % 4096).toBe(0);
    expect(word(f, 12)).toBe(f.length - 20);
    expect(word(f, 16)).toBeGreaterThanOrEqual(word(f, 12));
  });
});

/** A code level around a kit, as the content package builds it. */
function levelOf(kit: LevelKit, tests: TestSpec[]): Level {
  return Level.parse({
    id: `os-kit-${kit.key}`,
    version: 1,
    track: 'nand-to-os',
    phase: 9,
    order: 1,
    title: kit.key,
    goal: kit.key,
    palette: [],
    starter: { parts: [], wires: [] },
    mode: 'code',
    code: {
      language: kit.language,
      starter: kit.starter,
      devices: ['uart', 'keyboard', 'timer', 'framebuffer', 'disk'],
      ramSize: OS_RAM_SIZE,
      library: kit.library,
      libc: false,
    },
    tests,
  });
}

function run(
  kit: LevelKit,
  disk: string,
  input: string | undefined,
  expect: { uart: string; exitCode: number },
) {
  const test = {
    kind: 'riscv' as const,
    setup: { disk: diskSetup(kit.disks[disk]!) },
    ...(input ? { input } : {}),
    expect,
    maxSteps: 50_000_000,
  };
  const level = levelOf(kit, [test]);
  return [
    ...runRiscvTest(kit.solution, level.tests[0] as Extract<TestSpec, { kind: 'riscv' }>, level),
  ][0]!;
}

describe('kits', () => {
  const kits = Object.fromEntries(LEVEL_KEYS.map((k) => [k, buildKit(k)])) as Record<
    (typeof LEVEL_KEYS)[number],
    LevelKit
  >;

  it('fit the level schema limits (16 library files, 200,000 characters each)', () => {
    for (const k of Object.values(kits)) {
      expect(k.library.length, k.key).toBeLessThanOrEqual(16);
      for (const f of k.library)
        expect(f.text.length, `${k.key}: ${f.name}`).toBeLessThanOrEqual(200_000);
      expect(k.solution.length).toBeGreaterThan(0);
      expect(k.starter).not.toBe(k.solution);
    }
  });

  it('OS-01: a hello-kernel image boots from disk', () => {
    const k = kits.boot;
    const r = run(k, 'hello', undefined, {
      uart: `boot: loaded ${k.facts['hello.size']} bytes at 0x80200000, jumping to 0x80200000\nHello from the kernel!\n`,
      exitCode: 0,
    });
    expect(r.pass, r.message).toBe(true);
  });

  it('OS-03: ls, cat, echo and run work in the shell, end to end', () => {
    const k = kits.shell;
    const ls = ['ls', 'cat', 'echo', 'hello', 'readme.txt', 'kernel']
      .map((n) => n.padEnd(14) + k.sizes[n] + '\n')
      .join('');
    const r = run(k, 'os', 'ls\ncat readme.txt\necho one  two\nhello x\n', {
      uart:
        `$ ls\n${ls}$ cat readme.txt\nWelcome to your own operating system!\nThis file lives on the disk.\n` +
        '$ echo one  two\none two\n$ hello x\nHello from pid 5!\n  argv[0] = hello\n  argv[1] = x\n$ ',
      exitCode: 0,
    });
    expect(r.pass, r.message).toBe(true);
  });
});
