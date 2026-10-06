/**
 * OS-05: struct layouts and constants read from the kernel's own kernel.h,
 * so the OS panels decode memory exactly as the level's kernel lays it out
 * (fields come and go with the stage's features: wake time from TIMER, page
 * table from VM, open files from FS). A small parser for the header subset
 * the kernel uses: object-like #defines, typedefs of base types, and structs
 * of base types, pointers, nested structs and arrays. Layout follows our C
 * compiler (ILP32, natural alignment), as RISC-V's psABI does.
 */

export interface Field {
  name: string;
  /** Byte offset in the struct. */
  offset: number;
  /** Bytes of the whole field (all elements of an array). */
  size: number;
  /** Element type: a base type name ('uint', 'char'…), 'ptr', or 'struct <tag>'. */
  type: string;
  /** Element count when the field is an array. */
  count?: number;
  /** Bytes of one element. */
  elemSize: number;
  /** Signed integer (int, char) rather than unsigned. */
  signed: boolean;
}

export interface StructLayout {
  name: string;
  size: number;
  align: number;
  fields: Field[];
}

export interface KernelHeader {
  defines: ReadonlyMap<string, number>;
  structs: ReadonlyMap<string, StructLayout>;
}

const BASE: Record<string, { size: number; signed: boolean }> = {
  char: { size: 1, signed: true },
  'signed char': { size: 1, signed: true },
  'unsigned char': { size: 1, signed: false },
  short: { size: 2, signed: true },
  'unsigned short': { size: 2, signed: false },
  int: { size: 4, signed: true },
  'signed int': { size: 4, signed: true },
  unsigned: { size: 4, signed: false },
  'unsigned int': { size: 4, signed: false },
  long: { size: 4, signed: true },
  'unsigned long': { size: 4, signed: false },
};

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/** Evaluate a constant integer expression over numbers and known defines; undefined if it uses anything else. */
export function evalConst(expr: string, defines: ReadonlyMap<string, number>): number | undefined {
  const toks = expr.match(/0[xX][0-9a-fA-F]+[uUlL]*|\d+[uUlL]*|[A-Za-z_]\w*|<<|>>|[-+*/%()|&^~]/g);
  if (!toks || toks.join('').length !== expr.replace(/\s+/g, '').length) return undefined;
  let i = 0;
  const peek = () => toks[i];
  const prim = (): number | undefined => {
    const t = toks[i++];
    if (t === undefined) return undefined;
    if (t === '(') {
      const v = bin(0);
      if (toks[i++] !== ')') return undefined;
      return v;
    }
    if (t === '-' || t === '~' || t === '+') {
      const v = prim();
      if (v === undefined) return undefined;
      return t === '-' ? -v : t === '~' ? ~v : v;
    }
    if (/^\d|^0[xX]/.test(t)) return Number(t.replace(/[uUlL]+$/, ''));
    return defines.get(t);
  };
  const PREC: Record<string, number> = { '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
  const bin = (min: number): number | undefined => {
    let l = prim();
    for (;;) {
      const op = peek();
      const p = op !== undefined ? PREC[op] : undefined;
      if (l === undefined || p === undefined || p < min) return l;
      i++;
      const r = bin(p + 1);
      if (r === undefined) return undefined;
      switch (op) {
        case '|': l = l | r; break;
        case '^': l = l ^ r; break;
        case '&': l = l & r; break;
        case '<<': l = l << r; break;
        case '>>': l = l >>> r; break;
        case '+': l = l + r; break;
        case '-': l = l - r; break;
        case '*': l = l * r; break;
        case '/': l = r ? Math.trunc(l / r) : 0; break;
        case '%': l = r ? l % r : 0; break;
      } // prettier-ignore
    }
  };
  const v = bin(0);
  return i === toks.length && v !== undefined ? (v >>> 0 === v || v < 0 ? v : v >>> 0) : undefined;
}

/** Parse kernel.h (or any header in the kernel's C subset). Unknown constructs are skipped. */
export function parseHeader(text: string): KernelHeader {
  const src = stripComments(text);
  const defines = new Map<string, number>();
  const pending: [string, string][] = [];
  for (const m of src.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)(?!\()[ \t]+([^\n]+)$/gm)) pending.push([m[1]!, m[2]!.trim()]);
  // Defines may refer to later ones: settle in a few passes.
  for (let pass = 0; pass < 4 && pending.length; pass++)
    for (let k = pending.length - 1; k >= 0; k--) {
      const [name, expr] = pending[k]!;
      const v = evalConst(expr, defines);
      if (v !== undefined) {
        defines.set(name, v);
        pending.splice(k, 1);
      }
    }

  const typedefs = new Map<string, { size: number; signed: boolean }>();
  const body = src.replace(/^[ \t]*#[^\n]*$/gm, ' ');
  for (const m of body.matchAll(/typedef\s+([\w\s]+?)\s+([A-Za-z_]\w*)\s*;/g)) {
    const base = BASE[m[1]!.replace(/\s+/g, ' ')];
    if (base) typedefs.set(m[2]!, base);
  }

  const structs = new Map<string, StructLayout>();
  for (const m of body.matchAll(/struct\s+([A-Za-z_]\w*)\s*\{([^{}]*)\}\s*;/g)) {
    const name = m[1]!;
    const fields: Field[] = [];
    let offset = 0;
    let align = 1;
    let ok = true;
    for (const decl of m[2]!.split(';')) {
      const d = decl.trim().replace(/\s+/g, ' ');
      if (!d) continue;
      const f = /^(?:const |volatile )*(struct [A-Za-z_]\w*|[A-Za-z_][\w ]*?) ?(\*+)? ?([A-Za-z_]\w*)((?: ?\[[^\]]+\])*)$/.exec(d);
      if (!f) {
        ok = false;
        break;
      }
      const [, typeName, stars, fieldName, dims] = f;
      let elem: { size: number; align: number; signed: boolean; type: string } | undefined;
      if (stars) elem = { size: 4, align: 4, signed: false, type: 'ptr' };
      else if (typeName!.startsWith('struct ')) {
        const s = structs.get(typeName!.slice(7));
        if (s) elem = { size: s.size, align: s.align, signed: false, type: typeName! };
      } else {
        const b = BASE[typeName!] ?? typedefs.get(typeName!);
        if (b) elem = { size: b.size, align: b.size, signed: b.signed, type: typeName! };
      }
      if (!elem) {
        ok = false;
        break;
      }
      let count: number | undefined;
      for (const dm of dims!.matchAll(/\[([^\]]+)\]/g)) {
        const n = evalConst(dm[1]!, defines);
        if (n === undefined) {
          ok = false;
          break;
        }
        count = (count ?? 1) * n;
      }
      if (!ok) break;
      offset = Math.ceil(offset / elem.align) * elem.align;
      const size = elem.size * (count ?? 1);
      fields.push({ name: fieldName!, offset, size, type: elem.type, elemSize: elem.size, signed: elem.signed, ...(count !== undefined ? { count } : {}) });
      offset += size;
      align = Math.max(align, elem.align);
    }
    if (!ok) continue;
    structs.set(name, { name, size: Math.ceil(offset / align) * align, align, fields });
  }
  return { defines, structs };
}

export const fieldOf = (s: StructLayout | undefined, name: string): Field | undefined => s?.fields.find((f) => f.name === name);

/** Read a scalar field (element `i` of an array) from `view` at struct offset `base`. */
export function readField(view: DataView, base: number, f: Field, i = 0): number {
  const at = base + f.offset + i * f.elemSize;
  if (at < 0 || at + f.elemSize > view.byteLength) return 0;
  if (f.elemSize === 1) return f.signed ? view.getInt8(at) : view.getUint8(at);
  if (f.elemSize === 2) return f.signed ? view.getInt16(at, true) : view.getUint16(at, true);
  return f.signed ? view.getInt32(at, true) : view.getUint32(at, true);
}

/** A char array field as a string (up to the first 0). */
export function readString(view: DataView, base: number, f: Field): string {
  let s = '';
  for (let i = 0; i < (f.count ?? 1); i++) {
    const at = base + f.offset + i;
    if (at >= view.byteLength) break;
    const c = view.getUint8(at);
    if (!c) break;
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '?';
  }
  return s;
}
