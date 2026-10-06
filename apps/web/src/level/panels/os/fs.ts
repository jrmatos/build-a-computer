/**
 * OS-05: the file system on the block device (docs/os.md, "On-disk
 * format"), parsed with the superblock, inode and directory-entry layouts
 * from kernel.h. Pure: `disk` is the raw sectors.
 */

import { fieldOf, readField, readString, type KernelHeader } from './header';

export const SECTOR = 512;

export interface BootBlock {
  load: number;
  entry: number;
  start: number;
  count: number;
  size: number;
}

export interface Superblock {
  magic: number;
  nsectors: number;
  ninodes: number;
  inodestart: number;
  datastart: number;
}

export interface Inode {
  inum: number;
  type: number;
  size: number;
  /** Data sectors in file order (direct, then those the indirect sector lists). */
  sectors: number[];
  /** The indirect sector, when the file has one. */
  indirect?: number;
}

export interface DirEntry {
  inum: number;
  name: string;
  type: number;
  size: number;
}

export interface FsView {
  disk: number;
  boot?: BootBlock;
  sb?: Superblock;
  /** Why there is no file system to show. */
  problem?: 'empty' | 'noMagic';
  inodes: Inode[];
  root: DirEntry[];
}

const word = (disk: Uint8Array, at: number): number =>
  at + 4 <= disk.length ? (disk[at]! | (disk[at + 1]! << 8) | (disk[at + 2]! << 16) | (disk[at + 3]! << 24)) >>> 0 : 0;

/** Parse the disk. Layouts come from kernel.h; constants fall back to docs/os.md's. */
export function parseFs(header: KernelHeader, disk: Uint8Array): FsView {
  const d = header.defines;
  const view = new DataView(disk.buffer, disk.byteOffset, disk.byteLength);
  const out: FsView = { disk: disk.length, inodes: [], root: [] };
  if (!disk.length) return { ...out, problem: 'empty' };
  const sector = d.get('SECTOR') ?? SECTOR;
  if (word(disk, 0) === 0x544f4f42)
    out.boot = { load: word(disk, 4), entry: word(disk, 8), start: word(disk, 12), count: word(disk, 16), size: word(disk, 20) };
  const sbL = header.structs.get('superblock');
  const at = (d.get('SUPER_SECTOR') ?? 1) * sector;
  const get = (name: string): number => {
    const f = fieldOf(sbL, name);
    return f ? readField(view, at, f) >>> 0 : 0;
  };
  const sb: Superblock = { magic: get('magic'), nsectors: get('nsectors'), ninodes: get('ninodes'), inodestart: get('inodestart'), datastart: get('datastart') };
  if (!sbL || sb.magic !== (d.get('FS_MAGIC') ?? 0x53464342)) return { ...out, problem: 'noMagic' };
  out.sb = sb;
  const di = header.structs.get('dinode');
  const typeF = fieldOf(di, 'type');
  const sizeF = fieldOf(di, 'size');
  const addrsF = fieldOf(di, 'addrs');
  const ndirect = d.get('NDIRECT') ?? 12;
  const isize = di?.size ?? 64;
  for (let inum = 1; inum < Math.min(sb.ninodes, 1024); inum++) {
    const base = sb.inodestart * sector + inum * isize;
    if (!typeF || base + isize > disk.length) break;
    const type = readField(view, base, typeF);
    if (!type) continue;
    const size = sizeF ? readField(view, base, sizeF) >>> 0 : 0;
    const used = Math.ceil(size / sector);
    const sectors: number[] = [];
    const node: Inode = { inum, type, size, sectors };
    if (addrsF) {
      for (let i = 0; i < Math.min(used, ndirect); i++) sectors.push(readField(view, base, addrsF, i) >>> 0);
      if (used > ndirect) {
        const ind = readField(view, base, addrsF, ndirect) >>> 0;
        node.indirect = ind;
        for (let i = 0; i < used - ndirect && i < sector / 4; i++) sectors.push(word(disk, ind * sector + i * 4));
      }
    }
    out.inodes.push(node);
  }
  const rootInum = d.get('ROOT_INUM') ?? 1;
  const root = out.inodes.find((n) => n.inum === rootInum);
  const de = header.structs.get('dirent');
  const inumF = fieldOf(de, 'inum');
  const nameF = fieldOf(de, 'name');
  if (root && de && inumF && nameF) {
    for (let off = 0; off + de.size <= root.size; off += de.size) {
      const s = root.sectors[Math.floor(off / sector)];
      if (s === undefined) break;
      const at2 = s * sector + (off % sector);
      const inum = readField(view, at2, inumF) >>> 0;
      if (!inum) continue;
      const node = out.inodes.find((n) => n.inum === inum);
      out.root.push({ inum, name: readString(view, at2, nameF), type: node?.type ?? 0, size: node?.size ?? 0 });
    }
  }
  return out;
}
