import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileSync, type SyncState } from './autosave';
import { StorageError } from './provider';

/** A fake target whose writes can be held open or made to fail. */
function fakeTarget() {
  const writes: string[] = [];
  let fail: StorageError | null = null;
  let gate: Promise<void> | null = null;
  return {
    writes,
    failWith(e: StorageError | null) {
      fail = e;
    },
    hold() {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
    async write(text: string) {
      if (gate) await gate;
      if (fail) throw fail;
      writes.push(text);
    },
  };
}

function setup(delayMs = 2000) {
  const target = fakeTarget();
  let n = 0;
  const states: SyncState[] = [];
  const errors: StorageError[] = [];
  const sync = new FileSync({
    target,
    serialize: async () => `v${++n}`,
    delayMs,
    onState: (s) => states.push(s),
    onError: (e) => errors.push(e),
  });
  return { sync, target, states, errors };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('FileSync autosave state machine', () => {
  it('does nothing while no file is connected', async () => {
    const { sync, target } = setup();
    sync.markDirty();
    await vi.runAllTimersAsync();
    expect(target.writes).toEqual([]);
    expect(sync.state.status).toBe('none');
  });

  it('connect writes the workspace at once', async () => {
    const { sync, target } = setup();
    await sync.connect('w.json');
    expect(target.writes).toEqual(['v1']);
    expect(sync.state).toMatchObject({ status: 'saved', fileName: 'w.json', error: null });
  });

  it('debounces: one write ~2 s after the last of many changes', async () => {
    const { sync, target } = setup();
    await sync.connect('w.json');
    sync.markDirty();
    expect(sync.state.status).toBe('dirty');
    await vi.advanceTimersByTimeAsync(1500);
    sync.markDirty();
    await vi.advanceTimersByTimeAsync(1500);
    expect(target.writes).toEqual(['v1']);
    await vi.advanceTimersByTimeAsync(600);
    expect(target.writes).toEqual(['v1', 'v2']);
    expect(sync.state.status).toBe('saved');
  });

  it('flush writes right away (tab hidden) and is a no-op when clean', async () => {
    const { sync, target } = setup();
    await sync.connect('w.json');
    sync.markDirty();
    await sync.flush();
    expect(target.writes).toEqual(['v1', 'v2']);
    await sync.flush();
    expect(target.writes).toHaveLength(2);
    await sync.flush(true); // Ctrl+S
    expect(target.writes).toHaveLength(3);
  });

  it('passes through saving, and a change during a write triggers another write', async () => {
    const { sync, target, states } = setup();
    await sync.connect('w.json');
    const release = target.hold();
    sync.markDirty();
    const first = sync.flush();
    expect(sync.state.status).toBe('saving');
    sync.markDirty();
    void sync.flush();
    release();
    await first;
    expect(target.writes).toEqual(['v1', 'v2', 'v3']);
    expect(sync.state.status).toBe('saved');
    expect(states.map((s) => s.status)).toContain('saving');
  });

  it('E-PLAT-02: a write failure keeps the changes dirty and reports an error', async () => {
    const { sync, target, errors } = setup();
    await sync.connect('w.json');
    target.failWith(new StorageError('write-failed', 'disk full'));
    sync.markDirty();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.state).toMatchObject({ status: 'error', error: 'write-failed' });
    expect(errors.map((e) => e.code)).toEqual(['write-failed']);
    // Transient failures retry on the next change.
    target.failWith(null);
    sync.markDirty();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.state.status).toBe('saved');
    expect(target.writes.at(-1)).toBe('v3');
  });

  it('E-PLAT-02: file deleted or permission revoked pauses autosave until the player acts', async () => {
    for (const code of ['not-found', 'permission', 'changed'] as const) {
      const { sync, target } = setup();
      await sync.connect('w.json');
      target.failWith(new StorageError(code));
      sync.markDirty();
      await vi.advanceTimersByTimeAsync(2000);
      expect(sync.state).toMatchObject({ status: 'error', error: code });
      const before = target.writes.length;
      target.failWith(null);
      sync.markDirty();
      await vi.advanceTimersByTimeAsync(5000);
      // No retry behind the player's back...
      expect(target.writes).toHaveLength(before);
      expect(sync.state.status).toBe('error');
      // ...until they act (e.g. allow permission again), then everything pending is written.
      await sync.flush(true);
      expect(target.writes).toHaveLength(before + 1);
      expect(sync.state.status).toBe('saved');
    }
  });

  it('disconnect stops autosaving and cancels a pending write', async () => {
    const { sync, target } = setup();
    await sync.connect('w.json');
    sync.markDirty();
    sync.disconnect();
    await vi.advanceTimersByTimeAsync(5000);
    expect(target.writes).toEqual(['v1']);
    expect(sync.state).toMatchObject({ status: 'none', fileName: null });
  });

  it('connect without writing starts clean', async () => {
    const { sync, target } = setup();
    await sync.connect('w.json', false);
    expect(target.writes).toEqual([]);
    expect(sync.state.status).toBe('saved');
  });
});
