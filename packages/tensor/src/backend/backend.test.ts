import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { allClose, randn, Rng, tensor } from '../tensor';
import {
  CPU_BUDGET,
  CpuBackend,
  estimateMemory,
  fitConfig,
  gpuBudget,
  type ModelConfig,
} from './backend';
import { createBackend, ResilientBackend, selfTest } from './select';
import {
  BINARY_EXPR,
  binaryMeta,
  binaryShader,
  checkBufferSize,
  chooseMatmulTile,
  DEFAULT_GPU_LIMITS,
  dispatch1D,
  dispatchMatmul,
  GpuLimitError,
  layerNormShader,
  matmulPlan,
  matmulShader,
  reduceShader,
  softmaxShader,
  UNARY_EXPR,
  unaryShader,
  WORKGROUP,
  type GpuBinaryOp,
  type GpuUnaryOp,
} from './wgsl';
import {
  readLimits,
  WebGpuBackend,
  type GpuAdapterLike,
  type GpuDeviceLike,
  type GpuLike,
} from './webgpu';

// ---------------------------------------------------------------------------
// A fake WebGPU that records what the backend asks for. It cannot run WGSL;
// the readback returns `fill` for every output element.
// ---------------------------------------------------------------------------

interface FakeLog {
  buffers: { size: number; usage: number }[];
  shaders: string[];
  dispatches: number[][];
  writes: ArrayBufferView[];
  bindings: number[];
}

function fakeDevice(limits: Partial<typeof DEFAULT_GPU_LIMITS> = {}, fill = 0) {
  const log: FakeLog = { buffers: [], shaders: [], dispatches: [], writes: [], bindings: [] };
  let loseDevice: (info: { reason?: string; message?: string }) => void = () => {};
  const device: GpuDeviceLike = {
    limits: { ...DEFAULT_GPU_LIMITS, ...limits },
    lost: new Promise((resolve) => (loseDevice = resolve)),
    queue: {
      writeBuffer: (_b, _o, data) => void log.writes.push(data),
      submit: () => {},
    },
    createBuffer: ({ size, usage }) => {
      log.buffers.push({ size, usage });
      return {
        size,
        mapAsync: async () => {},
        getMappedRange: () => new Float32Array(size / 4).fill(fill).buffer,
        unmap: () => {},
        destroy: () => {},
      };
    },
    createShaderModule: ({ code }) => {
      log.shaders.push(code);
      return {};
    },
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: ({ entries }) => {
      log.bindings.push(entries.length);
      return {};
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => {},
        setBindGroup: () => {},
        dispatchWorkgroups: (x, y = 1, z = 1) => void log.dispatches.push([x, y, z]),
        end: () => {},
      }),
      copyBufferToBuffer: () => {},
      finish: () => ({}),
    }),
    destroy: () => {},
  };
  return { device, log, lose: (message: string) => loseDevice({ reason: 'unknown', message }) };
}

function fakeGpu(
  devices: GpuDeviceLike[],
  adapterLimits: Partial<typeof DEFAULT_GPU_LIMITS> = {},
): GpuLike & { requests: number } {
  const gpu = {
    requests: 0,
    async requestAdapter(): Promise<GpuAdapterLike | null> {
      gpu.requests++;
      const device = devices.shift();
      if (!device) return null;
      return {
        limits: { ...DEFAULT_GPU_LIMITS, ...adapterLimits },
        requestDevice: async () => device,
      };
    },
  };
  return gpu;
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

// ---------------------------------------------------------------------------

describe('WGSL generation', () => {
  it('every binary and unary op has an expression in its shader', () => {
    for (const op of Object.keys(BINARY_EXPR) as GpuBinaryOp[]) {
      const code = binaryShader(op);
      expect(code).toContain(`Y[i] = ${BINARY_EXPR[op]};`);
      expect(code).toContain('@binding(3) var<storage, read> dims');
      expect(code).toContain(`@workgroup_size(${WORKGROUP})`);
    }
    for (const op of Object.keys(UNARY_EXPR) as GpuUnaryOp[]) {
      expect(unaryShader(op)).toContain(`Y[i] = ${UNARY_EXPR[op]};`);
    }
  });

  it('shaders are balanced and declare one entry point', () => {
    const all = [
      binaryShader('add'),
      unaryShader('gelu'),
      reduceShader('sum'),
      reduceShader('max'),
      softmaxShader(),
      layerNormShader(),
      matmulShader(16),
      matmulShader(8),
    ];
    for (const code of all) {
      for (const [open, close] of [
        ['{', '}'],
        ['(', ')'],
        ['[', ']'],
      ] as const) {
        expect(code.split(open).length).toBe(code.split(close).length);
      }
      expect(code.match(/fn main\(/g)).toHaveLength(1);
      expect(code).toMatch(/@compute @workgroup_size/);
      expect(code).not.toMatch(/undefined|NaN/);
    }
  });

  it('no shader names anything `meta` (a WGSL reserved word: the real GPU rejected the binary shader)', () => {
    const all = [binaryShader('add'), unaryShader('gelu'), reduceShader('sum'), softmaxShader(), layerNormShader(), matmulShader(16)];
    for (const code of all) expect(code).not.toMatch(/\bmeta\b/);
  });

  it('matmul shader uses the requested tile and barriers', () => {
    const code = matmulShader(8);
    expect(code).toContain('const TILE: u32 = 8u;');
    expect(code).toContain('array<array<f32, 8>, 8>');
    expect(code).toContain('@workgroup_size(8, 8, 1)');
    expect(code.match(/workgroupBarrier\(\)/g)).toHaveLength(2);
  });

  it('reduce max starts from the first element; sum from zero', () => {
    expect(reduceShader('max')).toContain('var acc = X[base];');
    expect(reduceShader('max')).toContain('max(acc, v)');
    expect(reduceShader('sum')).toContain('var acc = 0.0;');
  });
});

describe('GPU shape and dispatch logic', () => {
  it('binaryMeta encodes sizes and broadcast strides', () => {
    const { outShape, meta } = binaryMeta([2, 1, 3], [4, 1]);
    expect(outShape).toEqual([2, 4, 3]);
    expect(Array.from(meta)).toEqual([24, 3, 2, 4, 3, 3, 0, 1, 0, 1, 0]);
  });

  it('binaryMeta indexing matches the CPU broadcast (simulated in JS)', () => {
    const rng = new Rng(1);
    const a = randn([3, 1, 4], { rng });
    const b = randn([5, 1], { rng });
    const { meta } = binaryMeta(a.shape, b.shape);
    const out = new Float32Array(meta[0]!);
    const rank = meta[1]!;
    for (let i = 0; i < out.length; i++) {
      // Same loop as the WGSL shader.
      let rest = i;
      let ia = 0;
      let ib = 0;
      for (let d = 0; d < rank; d++) {
        const ax = rank - 1 - d;
        const size = meta[2 + ax]!;
        const coord = rest % size;
        rest = Math.floor(rest / size);
        ia += coord * meta[2 + rank + ax]!;
        ib += coord * meta[2 + 2 * rank + ax]!;
      }
      out[i] = a.data[ia]! + b.data[ib]!;
    }
    expect(allClose(tensor(out, { shape: [3, 5, 4] }), a.add(b))).toBe(true);
  });

  it('dispatch1D spreads big jobs over two grid axes', () => {
    expect(dispatch1D(1, DEFAULT_GPU_LIMITS)).toEqual([1, 1, 1]);
    expect(dispatch1D(64 * 10, DEFAULT_GPU_LIMITS)).toEqual([10, 1, 1]);
    const n = 65535 * 64 * 3;
    const [x, y] = dispatch1D(n, DEFAULT_GPU_LIMITS);
    expect(x * y * WORKGROUP).toBeGreaterThanOrEqual(n);
    expect(x).toBeLessThanOrEqual(65535);
    expect(() => dispatch1D(2 ** 40, DEFAULT_GPU_LIMITS)).toThrow(GpuLimitError);
  });

  it('matmul grid and batch plan', () => {
    expect(dispatchMatmul(33, 17, 2, 16, DEFAULT_GPU_LIMITS)).toEqual([2, 3, 2]);
    expect(() => dispatchMatmul(1, 1, 70000, 16, DEFAULT_GPU_LIMITS)).toThrow(GpuLimitError);
    expect(matmulPlan([2, 3, 4], [4, 5])).toMatchObject({
      batch: 2,
      aStride: 12,
      bStride: 0,
      outShape: [2, 3, 5],
    });
    expect(matmulPlan([3, 4], [2, 4, 5])).toMatchObject({ batch: 2, aStride: 0, bStride: 20 });
    expect(matmulPlan([2, 1, 3, 4], [1, 2, 4, 5])).toBeNull(); // needs a real broadcast
    expect(matmulPlan([1, 3, 4], [2, 4, 5])).toMatchObject({ aStride: 0 });
    expect(() => matmulPlan([3, 4], [5, 6])).toThrow(/inner sizes/);
  });

  it('E-ML-04: tile size and buffer checks follow the adapter limits', () => {
    expect(chooseMatmulTile(DEFAULT_GPU_LIMITS)).toBe(16);
    expect(
      chooseMatmulTile({ ...DEFAULT_GPU_LIMITS, maxComputeInvocationsPerWorkgroup: 128 }),
    ).toBe(8);
    expect(chooseMatmulTile({ ...DEFAULT_GPU_LIMITS, maxComputeWorkgroupStorageSize: 1024 })).toBe(
      8,
    );
    expect(() => checkBufferSize(2 ** 28, DEFAULT_GPU_LIMITS)).toThrow(/binds at most/);
    expect(() => checkBufferSize(1024, DEFAULT_GPU_LIMITS)).not.toThrow();
    expect(readLimits({ maxBufferSize: 2 ** 31 }).maxBufferSize).toBe(2 ** 31);
    expect(readLimits({}).maxStorageBufferBindingSize).toBe(
      DEFAULT_GPU_LIMITS.maxStorageBufferBindingSize,
    );
  });
});

describe('E-ML-04: fitting the model to the device', () => {
  const big: ModelConfig = {
    vocabSize: 65,
    dModel: 512,
    nHeads: 8,
    nLayers: 8,
    contextLength: 512,
    batchSize: 64,
  };

  it('E-ML-04: a config that fits is unchanged', () => {
    const small: ModelConfig = {
      vocabSize: 65,
      dModel: 64,
      nHeads: 4,
      nLayers: 2,
      contextLength: 64,
      batchSize: 8,
    };
    expect(fitConfig(small, CPU_BUDGET)).toEqual({ config: small, scaled: false, message: '' });
  });

  it('E-ML-04: a too-big config is scaled down with a message', () => {
    const fitted = fitConfig(big, CPU_BUDGET);
    expect(fitted.scaled).toBe(true);
    expect(fitted.message).toMatch(/scaled down: batchSize 64 → /);
    const m = estimateMemory(fitted.config);
    expect(m.totalBytes).toBeLessThanOrEqual(CPU_BUDGET.totalBytes);
    expect(m.largestBufferBytes).toBeLessThanOrEqual(CPU_BUDGET.maxBufferBytes);
    expect(fitted.config.dModel % fitted.config.nHeads).toBe(0);
  });

  it('E-ML-04: the GPU budget comes from the adapter limits', () => {
    const tiny = gpuBudget({ ...DEFAULT_GPU_LIMITS, maxStorageBufferBindingSize: 2 ** 20 });
    expect(tiny.maxBufferBytes).toBe(2 ** 20);
    const fitted = fitConfig(big, tiny);
    expect(estimateMemory(fitted.config).largestBufferBytes).toBeLessThanOrEqual(2 ** 20);
    expect(() => fitConfig({ ...big, vocabSize: 10 ** 7 }, tiny)).toThrow(/smaller vocabulary/);
  });
});

describe('E-ML-01: backend selection and fallback', () => {
  it('E-ML-01: no WebGPU means the CPU, with an explanation', async () => {
    const messages: string[] = [];
    const { backend, message } = await createBackend({
      gpu: null,
      onFallback: (m) => messages.push(m),
    });
    expect(backend.name).toBe('cpu');
    expect(message).toMatch(/no WebGPU support.*CPU with a smaller model/);
    expect(messages).toHaveLength(1);
    const y = await backend.matmul(tensor([[1, 2]]), tensor([[3], [4]]));
    expect(y.item()).toBe(11);
  });

  it('E-ML-01: an adapter that is unavailable falls back too', async () => {
    const { backend, message } = await createBackend({ gpu: fakeGpu([]) });
    expect(backend.name).toBe('cpu');
    expect(message).toMatch(/no GPU adapter/);
  });

  it('prefer cpu skips the GPU', async () => {
    const gpu = fakeGpu([fakeDevice().device]);
    const { backend } = await createBackend({ prefer: 'cpu', gpu });
    expect(backend.name).toBe('cpu');
    expect(gpu.requests).toBe(0);
  });

  it('uses WebGPU when available, reading limits first (E-ML-04)', async () => {
    const fake = fakeDevice({ maxStorageBufferBindingSize: 2 ** 20 });
    const { backend, message } = await createBackend({ gpu: fakeGpu([fake.device]) });
    expect(message).toBe('Using WebGPU.');
    expect(backend.name).toBe('webgpu');
    expect(backend.limits!.maxStorageBufferBindingSize).toBe(2 ** 20);
  });

  it('E-ML-05: float64 work stays on the CPU even with a GPU', async () => {
    const fake = fakeDevice({}, 123);
    const { backend } = await createBackend({ gpu: fakeGpu([fake.device]) });
    const a = tensor([[1, 2]], { dtype: 'float64' });
    const y = await backend.matmul(a, tensor([[3], [4]], { dtype: 'float64' }));
    expect(y.item()).toBe(11); // real CPU answer, not the fake GPU's 123
    expect(fake.log.dispatches).toHaveLength(0);
  });

  it('E-ML-04: a tensor larger than the device buffer limit runs on the CPU', async () => {
    const fake = fakeDevice({ maxStorageBufferBindingSize: 64 }, 123);
    const { backend } = await createBackend({ gpu: fakeGpu([fake.device]) });
    const x = randn([100]);
    const y = await backend.unary('relu', x);
    expect(allClose(y, x.relu())).toBe(true);
    expect(fake.log.dispatches).toHaveLength(0);
  });

  it('E-ML-01: device lost mid-run → one recovery attempt, then CPU for good', async () => {
    const first = fakeDevice({}, 7);
    const second = fakeDevice({}, 8);
    const gpu = fakeGpu([first.device, second.device]);
    const messages: string[] = [];
    const { backend } = await createBackend({ gpu, onFallback: (m) => messages.push(m) });
    expect((await backend.unary('relu', tensor([-1, 1]))).data[0]).toBe(7); // ran on fake GPU 1

    first.lose('driver reset');
    await flush();
    expect((await backend.unary('relu', tensor([-1, 1]))).data[0]).toBe(8); // recovered onto GPU 2
    expect(backend.deviceLosses).toBe(1);

    second.lose('driver reset again');
    await flush();
    const y = await backend.unary('relu', tensor([-1, 1]));
    expect(Array.from(y.data)).toEqual([0, 1]); // real CPU result
    expect(backend.name).toBe('cpu');
    expect(messages.join(' ')).toMatch(/GPU stopped responding \(driver reset again\).*checkpoint/);
  });

  it('WebGpuBackend wires buffers, bindings and dispatch for each kernel', async () => {
    const fake = fakeDevice();
    const be = new WebGpuBackend(fake.device, readLimits(fake.device.limits));
    const out = await be.matmul(randn([2, 33, 20]), randn([20, 17]));
    expect(out.shape).toEqual([2, 33, 17]);
    expect(fake.log.dispatches.at(-1)).toEqual([2, 3, 2]);
    expect(fake.log.bindings.at(-1)).toBe(4);
    const params = fake.log.writes.at(-1) as Uint32Array;
    expect(Array.from(params)).toEqual([33, 20, 17, 660, 0, 0, 0, 0]);

    expect((await be.reduce('sum', randn([3, 4, 5]), 1)).shape).toEqual([3, 5]);
    expect((await be.softmax(randn([6, 10]))).shape).toEqual([6, 10]);
    expect((await be.layerNorm(randn([6, 10]), 1e-5)).shape).toEqual([6, 10]);
    const ln = new Float32Array((fake.log.writes.at(-1) as Uint32Array).buffer);
    expect(ln[2]).toBeCloseTo(1e-5, 10);
    expect((await be.binary('add', randn([2, 3]), randn([3]))).shape).toEqual([2, 3]);
    expect(fake.log.bindings.at(-1)).toBe(4);
    // Pipelines are cached by shader text.
    const before = fake.log.shaders.length;
    await be.binary('add', randn([2, 3]), randn([3]));
    expect(fake.log.shaders.length).toBe(before);
    // Every buffer is a non-zero multiple of 4 bytes.
    for (const b of fake.log.buffers) expect(b.size % 4 === 0 && b.size >= 4).toBe(true);
  });
});

describe('self test harness', () => {
  it('passes for the CPU backend (the same harness checks a real GPU in the browser)', async () => {
    const rows = await selfTest(new CpuBackend());
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(row).toMatchObject({ ok: true, maxError: 0 });
  });

  it('a ResilientBackend without GPU passes too', async () => {
    const be = new ResilientBackend({ gpu: null });
    await be.init();
    expect((await selfTest(be)).every((r) => r.ok)).toBe(true);
  });
});

describe('performance', () => {
  it('CPU matmul 256×256 float32 is fast enough to train small models', () => {
    const rng = new Rng(1);
    const a = randn([256, 256], { rng });
    const b = randn([256, 256], { rng });
    a.matmul(b); // warm up the JIT
    const runs = 5;
    const start = performance.now();
    for (let i = 0; i < runs; i++) a.matmul(b);
    const ms = (performance.now() - start) / runs;
    const gflops = (2 * 256 ** 3) / (ms * 1e6);
    console.log(`CPU matmul 256x256: ${ms.toFixed(2)} ms (${gflops.toFixed(2)} GFLOP/s)`);
    expect(ms).toBeLessThan(500); // generous: CI machines vary
  });
});
