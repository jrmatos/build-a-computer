import { it } from 'vitest';
import { startJs, judgeJs, type GpuMode } from '@build-a-computer/js-check';
import { datasetById } from '../../datasets';
import { TRACK2_P4_7_LEVELS } from '../track2/phase4-7';

const SRC = String.raw`
import { load } from 'data';
import { Adam } from 'optim';
import { crossEntropy } from 'nn';
import { charVocab, createGPT, encodeChars, evalLoss, randomBatch, rng } from './gpt.js';
export async function train(steps, lr = 0.01, report1 = true) {
  const text = await load('text-macbeth');
  const vocab = charVocab(text);
  const ids = encodeChars(vocab, text);
  const n = Math.floor(ids.length * 0.9);
  const trainIds = ids.slice(0, n), valIds = ids.slice(n);
  const model = createGPT({ vocabSize: vocab.length, blockSize: 32, dModel: 32, nHead: 4, nLayer: 1, seed: 1 });
  const opt = new Adam(model.parameters(), { lr });
  const r = rng(1);
  const t0 = Date.now();
  for (let step = 0; step < steps; step++) {
    const { x, y } = randomBatch(trainIds, 8, 32, r);
    const loss = crossEntropy(model.forward(x), y);
    opt.zeroGrad(); loss.backward(); opt.step();
    if (report1) report({ loss });
  }
  const trainLoss = await evalLoss(model, trainIds, 32);
  return { device: model.device, ms: Date.now() - t0, trainLoss, valLoss: await evalLoss(model, valIds, 32) };
}`;

const level = TRACK2_P4_7_LEVELS.find((l) => l.id === 'train-tiny-gpt')!;
async function go(gpu: GpuMode, args: unknown[]) {
  const out = await startJs({ source: SRC, level, entry: 'train', args, gpu, timeoutMs: 600_000, seed: 1 }, { datasets: (id) => datasetById(id) }).done;
  console.log(gpu, JSON.stringify(args), JSON.stringify(out.result ?? out.error), out.ms);
}
it('exp', async () => {
  for (const s of [0, 300, 600]) await go('off', [s]);
  await go('off', [300, 0.003]);
  await go('emulated', [5]);
}, 900_000);
