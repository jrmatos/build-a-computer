import { describe, expect, it } from 'vitest';
import {
  ImportError,
  migrateWorkspace,
  NewerVersionError,
  parseImportFile,
  parseUntrustedJson,
  Workspace,
  WORKSPACE_LIMITS,
  WORKSPACE_VERSION,
  WorkspaceSettings,
} from './index';
import { z } from 'zod';

const board = {
  parts: [{ id: 'p1', type: 'nand', x: 0, y: 0, rot: 0, flip: false }],
  wires: [],
};

const save = {
  kind: 'ground-up/save',
  version: 2,
  chips: {},
  levelId: 'not-gate',
  levelVersion: 1,
  updatedAt: '2026-10-04T12:00:00.000Z',
  board,
};

const chip = {
  id: 'half',
  name: 'Half adder',
  version: 1,
  board,
  ports: { inputs: [], outputs: [] },
};

const workspace = {
  kind: 'ground-up/workspace',
  version: 1,
  exportedAt: '2026-10-05T09:00:00.000Z',
  appVersion: 'test',
  progress: { kind: 'ground-up/progress', version: 1, levels: { 'not-gate': { status: 'completed', levelVersion: 1 } } },
  saves: { 'not-gate': save },
  chips: { half: chip },
  settings: { theme: 'light', showGrid: true },
};

describe('Workspace', () => {
  it('round-trips through JSON', () => {
    const parsed = Workspace.parse(workspace);
    expect(Workspace.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(migrateWorkspace(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('rejects a save stored under another level id', () => {
    expect(() => Workspace.parse({ ...workspace, saves: { 'and-gate': save } })).toThrow();
  });

  it('rejects a bad embedded board', () => {
    const bad = { ...workspace, saves: { 'not-gate': { ...save, board: { parts: [{ id: 'a', type: 'laser', x: 0, y: 0 }], wires: [] } } } };
    expect(() => migrateWorkspace(bad)).toThrow();
  });

  it('settings and chips are optional', () => {
    const { settings: _s, chips: _c, ...bare } = workspace;
    const out = migrateWorkspace(bare);
    expect(out.chips).toEqual({});
    expect(out.settings).toBeUndefined();
  });
});

describe('E-DATA-04 / E-DATA-05 workspace migrations', () => {
  it('E-DATA-04: refuses a workspace from a newer version', () => {
    expect(() => migrateWorkspace({ ...workspace, version: WORKSPACE_VERSION + 1 })).toThrow(NewerVersionError);
  });
  it('E-DATA-04: refuses a workspace that embeds a newer save', () => {
    expect(() => migrateWorkspace({ ...workspace, saves: { 'not-gate': { ...save, version: 99 } } })).toThrow(NewerVersionError);
  });
  it('E-DATA-05: migrates embedded v1 saves without touching the input', () => {
    const { chips: _c, ...v1 } = { ...save, version: 1 };
    const input = { ...workspace, saves: { 'not-gate': v1 } };
    const before = structuredClone(input);
    const out = migrateWorkspace(input);
    expect(input).toEqual(before);
    expect(out.saves['not-gate']?.version).toBe(2);
    expect(out.saves['not-gate']?.chips).toEqual({});
  });
  it('E-DATA-05: runs workspace migration steps in order (injected v1 -> v2 -> v3)', () => {
    const seen: number[] = [];
    const steps = [
      (d: Record<string, unknown>) => (seen.push(d.version as number), { ...d, version: 2 }),
      (d: Record<string, unknown>) => (seen.push(d.version as number), { ...d, version: 3, settings: { theme: 'dark' } }),
    ];
    const V3 = z.object({ version: z.literal(3), settings: WorkspaceSettings }).passthrough() as unknown as z.ZodType<Workspace>;
    const input = { ...workspace, settings: undefined };
    const out = migrateWorkspace(input, { migrations: steps, latest: 3, schema: V3 });
    expect(seen).toEqual([1, 2]);
    expect(out.settings).toEqual({ theme: 'dark' });
    expect(input.version).toBe(1);
  });
  it('E-DATA-05: a missing migration step is an error, not a silent skip', () => {
    expect(() => migrateWorkspace(workspace, { migrations: [], latest: 2 })).toThrow(/Missing workspace migration/);
  });
  it('rejects a missing version and non-objects', () => {
    expect(() => migrateWorkspace({ ...workspace, version: undefined })).toThrow(TypeError);
    expect(() => migrateWorkspace(null)).toThrow(TypeError);
    expect(() => migrateWorkspace([])).toThrow(TypeError);
  });
});

describe('import detection', () => {
  it('detects a single-board save', () => {
    const out = parseImportFile(JSON.stringify(save));
    expect(out.kind).toBe('save');
  });
  it('detects a workspace', () => {
    const out = parseImportFile(JSON.stringify(workspace));
    expect(out.kind).toBe('workspace');
    if (out.kind === 'workspace') expect(Object.keys(out.workspace.saves)).toEqual(['not-gate']);
  });
  it('migrates an old single save on import', () => {
    const { chips: _c, ...v1 } = { ...save, version: 1 };
    const out = parseImportFile(JSON.stringify(v1));
    expect(out.kind === 'save' && out.save.version).toBe(2);
  });
  it('rejects unknown kinds', () => {
    expect(() => parseImportFile('{"kind":"something-else","version":1}')).toThrow(ImportError);
    expect(() => parseImportFile('[1,2]')).toThrow(ImportError);
  });
  it('E-DATA-04: refuses a newer workspace or save', () => {
    expect(() => parseImportFile(JSON.stringify({ ...workspace, version: 7 }))).toThrow(NewerVersionError);
    expect(() => parseImportFile(JSON.stringify({ ...save, version: 7 }))).toThrow(NewerVersionError);
  });
});

describe('E-DATA-03 hostile workspace imports', () => {
  it('E-DATA-03: strips prototype keys from workspaces', () => {
    const text = JSON.stringify(workspace).replace('{"kind":"ground-up/workspace"', '{"__proto__":{"polluted":true},"kind":"ground-up/workspace"');
    const out = parseImportFile(text);
    expect(out.kind).toBe('workspace');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('E-DATA-03: rejects deep nesting in a workspace', () => {
    expect(() => parseImportFile('['.repeat(100) + ']'.repeat(100))).toThrow(ImportError);
  });
  it('E-DATA-03: accepts workspaces between 5 and 20 MB but not saves', () => {
    const pad = 'x'.repeat(6 * 1024 * 1024);
    const bigWs = JSON.stringify({ ...workspace, appVersion: undefined, pad });
    expect(parseImportFile(bigWs).kind).toBe('workspace');
    const bigSave = JSON.stringify({ ...save, pad });
    expect(() => parseImportFile(bigSave)).toThrow(ImportError);
  });
  it('E-DATA-03: rejects workspaces over 20 MB', () => {
    expect(() => parseUntrustedJson(`"${'x'.repeat(WORKSPACE_LIMITS.maxBytes)}"`, WORKSPACE_LIMITS)).toThrow(/20 MB/);
  });
  it('E-DATA-03: rejects malformed JSON', () => {
    expect(() => parseImportFile('{nope')).toThrow(ImportError);
  });
});
