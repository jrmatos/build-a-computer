import { z } from 'zod';
import { Board, PartType } from './board';

const Bit = z.union([z.literal(0), z.literal(1)]);

/** One row of a truth-table test: input values by label, expected outputs by label. */
export const TruthRow = z.object({
  inputs: z.record(z.string(), Bit),
  expect: z.record(z.string(), Bit),
});
export type TruthRow = z.infer<typeof TruthRow>;

export const TestSpec = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('truth-table'), rows: z.array(TruthRow).min(1).max(65_536) }),
]);
export type TestSpec = z.infer<typeof TestSpec>;

export const ResourceTag = z.enum(['start-here', 'video', 'article', 'book', 'spec', 'course']);

export const Resource = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(200),
  tags: z.array(ResourceTag).default([]),
  lang: z.string().min(2).max(8).default('en'),
  differsNote: z.string().max(200).optional(),
  /** Set only by an agent or person who fetched the URL (E-RES-05). */
  verifiedTitle: z.string().min(1),
  verifiedAt: z.string().datetime(),
});
export type Resource = z.infer<typeof Resource>;

export const Level = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(64),
  version: z.number().int().min(1),
  track: z.enum(['nand-to-os', 'neuron-to-llm', 'sandbox']),
  phase: z.number().int().min(0),
  order: z.number().int().min(0),
  title: z.string().min(1).max(80),
  /** Short goal shown in the level panel. */
  goal: z.string().min(1).max(400),
  tutorial: z.string().max(20_000).default(''),
  hints: z.array(z.string().max(1000)).max(10).default([]),
  afterword: z.string().max(4000).default(''),
  /** Parts the player may place. Locked starter parts may use others. */
  palette: z.array(PartType),
  /** Locked inputs and outputs placed when the level opens. */
  starter: Board,
  tests: z.array(TestSpec).max(16).default([]),
  requires: z.array(z.string()).default([]),
  resources: z.array(Resource).max(4).default([]),
  draft: z.boolean().default(false),
});
export type Level = z.infer<typeof Level>;
