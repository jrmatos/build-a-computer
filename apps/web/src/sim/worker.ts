import * as Comlink from 'comlink';
import { SimHost } from '@build-a-computer/worker';
import type { DatasetProvider } from '@build-a-computer/js-check';

/**
 * Track 2 datasets for the sandbox's 'data' module. Loaded on first use, so
 * the generated digits and the text corpora stay out of the first-level bundle.
 */
const datasets: DatasetProvider = async (id) => {
  const { datasetById } = await import('@build-a-computer/content/datasets');
  const entry = datasetById(id);
  return entry ? { meta: entry.meta, load: async () => entry.load() } : undefined;
};

/** Simulation worker entry: all simulation state lives here, never on the main thread. */
Comlink.expose(new SimHost(undefined, undefined, { datasets }));
