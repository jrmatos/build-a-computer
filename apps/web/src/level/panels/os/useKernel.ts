/**
 * OS-05: the kernel model for the open level and its live state. The model
 * comes from the level's kernel.h (content's osKernelInfo) and the symbols
 * of the last build; the state is re-read at every stop (step, pause,
 * breakpoint) and at most 10 times a second while the program runs.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { osKernelInfo, type OsKernelInfo } from '@build-a-computer/content';
import { useEditor } from '../../../editor/store';
import { rv, useRvDebug } from '../../../sim/client';
import { readKernel, readSpace, type KernelIO, type KernelSnapshot } from './gather';
import { kernelModel, symbolRecord, type KernelModel } from './kernel';
import type { WalkResult } from './sv32';

export const io: KernelIO = {
  words: (addr, count, stride) => rv.readWords(addr, count, stride),
  bytes: (addr, length) => rv.memory(addr, length),
};

/** The open level's kernel model, or null while loading or when the build failed. */
export function useKernelModel(): { model: KernelModel | null; info: OsKernelInfo | null | undefined } {
  const level = useEditor((s) => s.level);
  const symbols = useRvDebug((s) => s.symbols);
  const [info, setInfo] = useState<{ id: string; info: OsKernelInfo | null } | null>(null);
  const id = level?.id;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void osKernelInfo(id).then((i) => alive && setInfo({ id, info: i }));
    return () => {
      alive = false;
    };
  }, [id]);
  const current = info && info.id === id ? info.info : undefined;
  const model = useMemo(() => (current ? kernelModel(current.header, symbolRecord(symbols), current.symbols) : null), [current, symbols]);
  return { model, info: current };
}

/** How often the panels re-read the kernel while the program runs. */
const LIVE_MS = 100;

/**
 * Re-read `fetch` at every stop and load, and every LIVE_MS while running
 * (one request in flight). Results from an older request never overwrite a
 * newer one.
 */
export function useLive<T>(fetch: (() => Promise<T | undefined>) | null, deps: readonly unknown[], whileRunning = true): T | undefined {
  const stop = useRvDebug((s) => s.stop);
  const loads = useRvDebug((s) => s.loads);
  const running = useEditor((s) => !!s.rv?.state.running);
  const loaded = useEditor((s) => !!s.rv);
  // Tagged with the load it came from: a new load starts empty.
  const [value, setValue] = useState<{ loads: number; v: T } | null>(null);
  const seq = useRef(0);
  const fetchRef = useRef(fetch);
  useEffect(() => {
    fetchRef.current = fetch;
  });

  const refresh = useRef(async () => {
    const f = fetchRef.current;
    if (!f) return;
    const n = ++seq.current;
    const at = useRvDebug.getState().loads;
    const v = await f();
    if (n === seq.current && v !== undefined) setValue({ loads: at, v });
  });

  useEffect(() => {
    if (!loaded) return;
    void refresh.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop, loads, loaded, ...deps]);

  useEffect(() => {
    if (!running || !whileRunning) return;
    let alive = true;
    let busy = false;
    const id = setInterval(() => {
      if (busy || !alive) return;
      busy = true;
      void refresh.current().finally(() => (busy = false));
    }, LIVE_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [running, whileRunning]);

  return value && value.loads === loads ? value.v : undefined;
}

/** The kernel's state now (process table, free list, address spaces, frames). */
export function useKernelSnapshot(model: KernelModel | null): KernelSnapshot | undefined {
  return useLive(model ? () => readKernel(io, model) : null, [model]);
}

/** The page table rooted at `root` (physical), live. */
export function useSpace(root: number | null): WalkResult | undefined {
  return useLive(root !== null ? () => readSpace(io, root) : null, [root]);
}
