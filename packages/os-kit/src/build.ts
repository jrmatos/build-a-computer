/**
 * Build a flat image from C and assembly files with the game's own tools
 * (@build-a-computer/cc and @build-a-computer/asm), at any base address:
 * kernels for the disk (linked where the bootloader puts them) and user
 * programs (linked at USER_BASE). Same rules as rv-check's buildProgram:
 * `.c` compiled, `.h` headers, anything else assembled, linked in order.
 */

import { type AsmObject, type LinkResult, assemble, link } from '@build-a-computer/asm';
import { compile } from '@build-a-computer/cc';
import { EXE_MAGIC } from './disk';

export interface SourceFile {
  name: string;
  text: string;
}

export class BuildError extends Error {}

/** Compile and link `files` at `base`. Throws BuildError with the first errors. */
export function buildImage(files: readonly SourceFile[], base: number): LinkResult {
  const headers: Record<string, string> = {};
  for (const f of files) if (f.name.endsWith('.h')) headers[f.name] = f.text;
  const errors: string[] = [];
  const objects: AsmObject[] = [];
  for (const f of files) {
    if (f.name.endsWith('.h')) continue;
    let text = f.text;
    let unit = f.name;
    if (f.name.endsWith('.c')) {
      const r = compile(f.text, { file: f.name, headers });
      for (const d of r.diagnostics)
        if (d.severity === 'error') errors.push(`${d.file}:${d.line}:${d.column}: ${d.message}`);
      if (!r.ok) continue;
      text = r.asm;
      unit = `${f.name}.s`;
    }
    const a = assemble(text, { file: unit });
    for (const d of a.diagnostics) errors.push(`${d.file}:${d.line}:${d.col}: ${d.message}`);
    objects.push(a.object);
  }
  if (errors.length) throw new BuildError(errors.slice(0, 8).join('\n'));
  const linked = link(objects, { base });
  if (!linked.ok)
    throw new BuildError(
      linked.diagnostics
        .slice(0, 8)
        .map((d) => `${d.file}:${d.line}:${d.col}: ${d.message}`)
        .join('\n'),
    );
  return linked;
}

/** Address of a linked symbol; throws when it is missing. */
export function symbol(linked: LinkResult, name: string): number {
  const s = linked.symbols.find((x) => x.name === name);
  if (!s) throw new BuildError(`no symbol ${name}`);
  return s.address >>> 0;
}

/**
 * A program file for the kernel's loader: a 20-byte header (magic, entry,
 * textsz, filesz, memsz) and the image, which was linked at USER_BASE.
 */
export function exeFile(linked: LinkResult): Uint8Array {
  // Code pages are mapped without write permission, so the code must end on
  // a page boundary (ucrt.s starts .rodata on a fresh page): round up.
  const text = linked.sections.find((s) => s.name === 'text');
  const textEnd = text ? text.address + text.size - linked.base : 0;
  const textsz = Math.ceil(textEnd / 4096) * 4096;
  const after = linked.sections.find((s) => s.name !== 'text' && s.size > 0);
  if (after && after.address - linked.base < textsz)
    throw new BuildError(
      'data shares a page with code: link ucrt.s first (its .rodata starts a page)',
    );
  const filesz = linked.image.length;
  const memsz = linked.end - linked.base;
  const out = new Uint8Array(20 + filesz);
  const dv = new DataView(out.buffer);
  [EXE_MAGIC, linked.entry, textsz, filesz, memsz].forEach((w, i) =>
    dv.setUint32(i * 4, w >>> 0, true),
  );
  out.set(linked.image, 20);
  return out;
}
