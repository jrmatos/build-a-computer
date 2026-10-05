/**
 * Disk image builder (OS-02): a boot block plus the tiny file system the
 * Phase 9 kernel reads. Pure and deterministic: the same inputs always give
 * the same bytes. The on-disk format is documented in docs/os.md and in
 * packages/os-kit/kernel/kernel.h (the C structs it must match).
 *
 * Layout (512-byte sectors, little-endian words):
 *
 *   0                 boot block: struct boothdr (zeros when not bootable)
 *   1                 superblock: magic, nsectors, ninodes, inodestart, datastart
 *   2 .. 2+N/8-1      inode table: N inodes of 64 bytes (8 per sector)
 *   datastart ...     data: the root directory, then each file's sectors
 *                     (contiguous), then its indirect sector when it has one
 *
 * Without files the disk is just the boot block and the raw kernel image
 * (from sector `rawStart`, default 1).
 */

export const SECTOR = 512;
export const BOOT_MAGIC = 0x544f_4f42; // "BOOT"
export const FS_MAGIC = 0x5346_4342; // "BCFS"
export const EXE_MAGIC = 0x4558_4542; // "BEXE"
export const SUPER_SECTOR = 1;
export const INODE_SIZE = 64;
export const NDIRECT = 12;
export const NINDIRECT = SECTOR / 4;
export const DIRENT_SIZE = 16;
export const DIRSIZ = 12;
export const ROOT_INUM = 1;
export const T_FILE = 1;
export const T_DIR = 2;
/** Largest file: 12 direct sectors plus 128 through the indirect sector. */
export const MAX_FILE_SIZE = (NDIRECT + NINDIRECT) * SECTOR;
/** The emulator's disk: 2,048 sectors (rv-check DISK_SIZE). */
export const DISK_SECTORS = 2048;

export interface BootImage {
  /** Bytes copied to `load`. */
  image: Uint8Array;
  load: number;
  entry: number;
}

export interface DiskFile {
  name: string;
  data: Uint8Array;
}

export interface DiskSpec {
  /** A kernel the bootloader loads; with files it is also the file `kernel`. */
  boot?: BootImage;
  /** First sector of a raw kernel (disks without files). Default 1. */
  rawStart?: number;
  /** Files in the root directory, in directory order. */
  files?: DiskFile[];
  /** Inode table size (a multiple of 8). Default 32. */
  ninodes?: number;
  /** Corrupt the boot block on purpose (tests): checksum off by one. */
  badChecksum?: boolean;
}

const le32 = (buf: Uint8Array, at: number, v: number): void => {
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint32(at, v >>> 0, true);
};
const rd32 = (buf: Uint8Array, at: number): number =>
  new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(at, true);

/** Sum of the bytes, modulo 2^32 (the boot header's checksum). */
export function checksum(bytes: Uint8Array): number {
  let s = 0;
  for (const b of bytes) s = (s + b) >>> 0;
  return s;
}

const sectorsFor = (n: number): number => Math.ceil(n / SECTOR);

function bootBlock(disk: Uint8Array, boot: BootImage, start: number, bad: boolean): void {
  const words = [
    BOOT_MAGIC,
    boot.load,
    boot.entry,
    start,
    sectorsFor(boot.image.length),
    boot.image.length,
    (checksum(boot.image) + (bad ? 1 : 0)) >>> 0,
  ];
  words.forEach((w, i) => le32(disk, i * 4, w));
}

/** Build a disk image. Its length is the sectors used (a multiple of 512). */
export function buildDisk(spec: DiskSpec): Uint8Array {
  const files = spec.files;
  if (!files) {
    const start = spec.rawStart ?? 1;
    const img = spec.boot?.image ?? new Uint8Array(0);
    const disk = new Uint8Array((start + sectorsFor(img.length)) * SECTOR);
    if (spec.boot) {
      bootBlock(disk, spec.boot, start, spec.badChecksum ?? false);
      disk.set(img, start * SECTOR);
    }
    return disk;
  }

  const all: DiskFile[] = [...files];
  if (spec.boot) all.push({ name: 'kernel', data: spec.boot.image });
  const names = new Set<string>();
  for (const f of all) {
    if (!/^[\x21-\x7e]{1,12}$/.test(f.name))
      throw new Error(`bad file name "${f.name}" (1 to 12 printable characters)`);
    if (names.has(f.name)) throw new Error(`duplicate file "${f.name}"`);
    names.add(f.name);
    if (f.data.length > MAX_FILE_SIZE)
      throw new Error(`file "${f.name}" is ${f.data.length} bytes (max ${MAX_FILE_SIZE})`);
  }
  const ninodes = spec.ninodes ?? 32;
  if (ninodes % 8 !== 0 || ninodes < all.length + 2) throw new Error('bad inode count');
  const inodestart = SUPER_SECTOR + 1;
  const datastart = inodestart + ninodes / 8;

  // Allocate sectors: root directory first, then each file in order.
  let next = datastart;
  const dirBytes = all.length * DIRENT_SIZE;
  const dirSectors = Math.max(1, sectorsFor(dirBytes));
  if (dirSectors > NDIRECT) throw new Error('too many files');
  const root = { start: next, count: dirSectors };
  next += dirSectors;
  const placed = all.map((f) => {
    const count = sectorsFor(f.data.length);
    const start = next;
    next += count;
    const indirect = count > NDIRECT ? next++ : 0;
    return { file: f, start, count, indirect };
  });
  const nsectors = next;
  if (nsectors > DISK_SECTORS)
    throw new Error(`disk needs ${nsectors} sectors (max ${DISK_SECTORS})`);
  const disk = new Uint8Array(nsectors * SECTOR);

  // Superblock.
  [FS_MAGIC, nsectors, ninodes, inodestart, datastart].forEach((w, i) =>
    le32(disk, SUPER_SECTOR * SECTOR + i * 4, w),
  );

  const writeInode = (
    inum: number,
    type: number,
    size: number,
    start: number,
    count: number,
    indirect: number,
  ): void => {
    const at = inodestart * SECTOR + inum * INODE_SIZE;
    le32(disk, at, type);
    le32(disk, at + 4, size);
    for (let b = 0; b < Math.min(count, NDIRECT); b++) le32(disk, at + 8 + b * 4, start + b);
    if (count > NDIRECT) {
      le32(disk, at + 8 + NDIRECT * 4, indirect);
      for (let b = NDIRECT; b < count; b++)
        le32(disk, indirect * SECTOR + (b - NDIRECT) * 4, start + b);
    }
  };

  // Root directory (inode 1) and its entries.
  writeInode(ROOT_INUM, T_DIR, dirBytes, root.start, root.count, 0);
  placed.forEach((p, i) => {
    const inum = ROOT_INUM + 1 + i;
    const at = root.start * SECTOR + i * DIRENT_SIZE;
    le32(disk, at, inum);
    for (let c = 0; c < p.file.name.length; c++) disk[at + 4 + c] = p.file.name.charCodeAt(c);
    writeInode(inum, T_FILE, p.file.data.length, p.start, p.count, p.indirect);
    disk.set(p.file.data, p.start * SECTOR);
  });

  if (spec.boot) {
    const k = placed.at(-1)!;
    bootBlock(disk, spec.boot, k.start, spec.badChecksum ?? false);
  }
  return disk;
}

/** A file as read back from a disk image (for tests and tools). */
export interface ListedFile {
  inum: number;
  name: string;
  type: number;
  data: Uint8Array;
}

/** Read the root directory back, the way the kernel does (tests). */
export function readDisk(disk: Uint8Array): ListedFile[] {
  const sb = SUPER_SECTOR * SECTOR;
  if (rd32(disk, sb) !== FS_MAGIC) throw new Error('no file system');
  const inodestart = rd32(disk, sb + 12);
  const inode = (inum: number) => {
    const at = inodestart * SECTOR + inum * INODE_SIZE;
    const type = rd32(disk, at);
    const size = rd32(disk, at + 4);
    const sector = (bn: number): number =>
      bn < NDIRECT
        ? rd32(disk, at + 8 + bn * 4)
        : rd32(disk, rd32(disk, at + 8 + NDIRECT * 4) * SECTOR + (bn - NDIRECT) * 4);
    const data = new Uint8Array(size);
    for (let off = 0; off < size; off += SECTOR) {
      const s = sector(off / SECTOR) * SECTOR;
      data.set(disk.subarray(s, s + Math.min(SECTOR, size - off)), off);
    }
    return { type, data };
  };
  const dir = inode(ROOT_INUM).data;
  const out: ListedFile[] = [];
  for (let off = 0; off < dir.length; off += DIRENT_SIZE) {
    const inum = rd32(dir, off);
    if (!inum) continue;
    let name = '';
    for (let c = 0; c < DIRSIZ && dir[off + 4 + c]; c++)
      name += String.fromCharCode(dir[off + 4 + c]!);
    const { type, data } = inode(inum);
    out.push({ inum, name, type, data });
  }
  return out;
}

/** Bytes as lowercase hex, two digits each. */
export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * A disk image as a riscv test's `setup.disk`: runs of non-zero sectors,
 * each at most `maxRun` sectors, as hex. All-zero sectors are left out (the
 * emulator's disk starts zeroed).
 */
export function diskSetup(disk: Uint8Array, maxRun = 64): { sector: number; hex: string }[] {
  const n = sectorsFor(disk.length);
  const zero = (s: number): boolean =>
    disk.subarray(s * SECTOR, (s + 1) * SECTOR).every((b) => b === 0);
  const out: { sector: number; hex: string }[] = [];
  let s = 0;
  while (s < n) {
    if (zero(s)) {
      s++;
      continue;
    }
    const start = s;
    while (s < n && !zero(s) && s - start < maxRun) s++;
    out.push({
      sector: start,
      hex: toHex(disk.subarray(start * SECTOR, Math.min(s * SECTOR, disk.length))),
    });
  }
  return out;
}
