import { PART_TYPES, Level, type PartType } from '@build-a-computer/schema';

/** The sandbox allows every built-in part; custom chips are always allowed separately. */
const ALL: PartType[] = PART_TYPES.filter((t) => t !== 'chip');

/** Free building: every part, no tests. */
export const SANDBOX = Level.parse({
  id: 'sandbox',
  version: 1,
  track: 'sandbox',
  phase: 0,
  order: 0,
  title: 'Sandbox',
  goal: 'Free building. Every part is unlocked and nothing is checked.',
  palette: ALL,
  starter: { parts: [], wires: [] },
  draft: true,
});
