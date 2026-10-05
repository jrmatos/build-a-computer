import { describe, expect, it } from 'vitest';
import { buildBundle, mapBundleLine, tokenize, transformModule } from './transform';

describe('transformModule', () => {
  it('rewrites imports to a header and keeps every line in place', () => {
    const src = [
      "import { tensor, zeros as z } from 'tensor';",
      "import * as nn from 'nn';",
      "import helpers, { add } from './helpers.js';",
      "import {",
      "  sparkline,",
      "} from 'plot';",
      'export function f() { return 1; }',
    ].join('\n');
    const m = transformModule(src, 'main.js');
    expect(m.body.split('\n')).toHaveLength(7);
    expect(m.body.split('\n')[6]).toBe('       function f() { return 1; }');
    expect(m.body.slice(0, -40).trim()).toBe('');
    expect(m.imports.map((i) => [i.spec, i.line])).toEqual([
      ['tensor', 1],
      ['nn', 2],
      ['./helpers.js', 3],
      ['plot', 4],
    ]);
    expect(m.header).toContain('"tensor": tensor');
    expect(m.header).toContain('"zeros": z');
    expect(m.header).toContain('const nn = __sbxNs1');
    expect(m.header).toContain('"default": helpers');
    expect(m.header).toContain('"f": () => f');
  });

  it('handles every export form', () => {
    const src = [
      'export const a = 1, b = { x: [1, 2] }, c = 3',
      'export let { d, e: ee } = { d: 1, e: 2 }',
      'export class K {}',
      'export async function g() {}',
      'export default function main() {}',
      'const h = 1;',
      'export { h as hh, h };',
      "export * from './lib.js';",
      "export { q as qq } from './lib.js'",
    ].join('\n');
    const m = transformModule(src, 'main.js');
    for (const name of ['"a"', '"b"', '"c"', '"d"', '"ee"', '"K"', '"g"', '"default": () => main', '"hh": () => h', '"h": () => h'])
      expect(m.header).toContain(name);
    expect(m.header).toContain('__sbx.reexp(__ex, await __sbx.imp("./lib.js", "main.js", 8), null');
    expect(m.header).toContain('[[\\"qq\\",\\"q\\"]]');
    expect(m.body).not.toMatch(/\bexport\b/);
  });

  it('export default of an expression assigns __ex.default without moving columns', () => {
    const m = transformModule('export default 40 + 2;\n', 'main.js');
    expect(m.body).toBe('__ex.default = 40 + 2;\n');
  });

  it('rewrites dynamic import() and import.meta but not strings, comments, regexes or members', () => {
    const src = [
      "const s = 'import x from \"y\"'; // import z from 'q'",
      '/* export default 1 */ const r = /import\\(\\{/g;',
      'const t = `${"{"} import ${1}`;',
      "const m = obj.import; const p = import('tensor'); const u = import.meta.url;",
    ].join('\n');
    const m = transformModule(src, 'main.js');
    const lines = m.body.split('\n');
    expect(lines.slice(0, 3)).toEqual(src.split('\n').slice(0, 3));
    expect(lines[3]).toBe("const m = obj.import; const p = __sbxI('tensor'); const u = __sbxM.meta.url;");
    expect(m.imports).toEqual([]);
  });

  it('reports unbalanced brackets with their line', () => {
    expect(() => transformModule('function f() {\n  return 1;\n}\n}\n', 'main.js')).toThrow();
    try {
      transformModule('const a = 1;\n}; fetch("x"); function g() {\n', 'main.js');
    } catch (e) {
      expect(e).toMatchObject({ file: 'main.js', line: 2, column: 1 });
    }
  });

  it('tokenizes division vs regex', () => {
    const toks = tokenize('const a = b / c / d; const r = /x}/.test(s);');
    expect(toks.filter((t) => t.type === 'regex').map((t) => t.value)).toEqual(['/x}/']);
  });
});

describe('buildBundle', () => {
  it('maps bundle lines back to module lines', () => {
    const main = transformModule('const a = 1;\nconst b = 2;\nthrow new Error("x");\n', 'main.js');
    const lib = transformModule('export const k = 1;\n', 'lib.js');
    const b = buildBundle([{ file: 'main.js', mod: main }, { file: 'lib.js', mod: lib }], '');
    const lines = b.code.split('\n');
    const at = lines.findIndex((l) => l.includes('throw new Error')) + 1;
    expect(mapBundleLine(b.map, at)).toEqual({ file: 'main.js', line: 3 });
    const k = lines.findIndex((l) => l.includes('const k')) + 1;
    expect(mapBundleLine(b.map, k)).toEqual({ file: 'lib.js', line: 1 });
  });
});
