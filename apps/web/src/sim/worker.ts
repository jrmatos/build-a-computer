import * as Comlink from 'comlink';
import { SimHost } from '@ground-up/worker';

/** Simulation worker entry: all simulation state lives here, never on the main thread. */
Comlink.expose(new SimHost());
