/**
 * Every achievement. Titles and descriptions live in i18n/en/achievements.ts
 * under `ach.<id>.title` / `ach.<id>.desc`. Rules are pure functions of the
 * evaluation context (engine.ts); nothing here touches storage or the DOM.
 *
 * Kinds of rule:
 * - `level`: finish that level (milestones). Backfilled from progress.
 * - `progress`: a counter with a target (x of n), shown as a bar.
 * - `test`: fires on one event (skill and fun ones). Not backfilled.
 *
 * `skill` rules never fire for a level whose solution was shown (ADR-007).
 */
import type { LevelInfo } from '@build-a-computer/content';
import type { Ctx, EngineEvent } from './engine';

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';
export type Category =
  | 'start'
  | 'hardware'
  | 'software'
  | 'ml'
  | 'phases'
  | 'skill'
  | 'community'
  | 'completion'
  | 'secret';
export type IconName =
  | 'bulb'
  | 'nand'
  | 'chip'
  | 'nest'
  | 'blocks'
  | 'bus'
  | 'clock'
  | 'cpu'
  | 'terminal'
  | 'spiral'
  | 'gear'
  | 'power'
  | 'kernel'
  | 'slope'
  | 'graph'
  | 'eye'
  | 'sparkle'
  | 'flag'
  | 'feather'
  | 'target'
  | 'check'
  | 'bolt'
  | 'mountain'
  | 'share'
  | 'pack'
  | 'disk'
  | 'bug'
  | 'stack'
  | 'crown'
  | 'moon'
  | 'run'
  | 'loop'
  | 'smoke';

export const CATEGORIES: readonly Category[] = [
  'start',
  'hardware',
  'software',
  'ml',
  'phases',
  'skill',
  'community',
  'completion',
  'secret',
];

export const TIER_POINTS: Record<Tier, number> = {
  bronze: 10,
  silver: 25,
  gold: 50,
  platinum: 100,
};

export interface Progress {
  value: number;
  target: number;
}

export interface AchievementDef {
  id: string;
  category: Category;
  tier: Tier;
  icon: IconName;
  /** Shown as "???" until unlocked. */
  hidden?: boolean;
  /** Excluded for levels whose solution was shown (ADR-007). */
  skill?: boolean;
  /** Milestone: unlocked once this level is completed. */
  level?: string;
  progress?: (ctx: Ctx) => Progress;
  test?: (e: EngineEvent, ctx: Ctx) => boolean;
}

// ---------------------------------------------------------------- helpers

const playable = (levels: readonly LevelInfo[]) =>
  levels.filter((l) => l.track !== 'sandbox' && !l.optional);

function countDone(ctx: Ctx, levels: readonly LevelInfo[]): Progress {
  return { value: levels.filter((l) => ctx.completed.has(l.id)).length, target: levels.length };
}

const inPhase = (ctx: Ctx, track: LevelInfo['track'], phase: number) =>
  playable(ctx.levels).filter((l) => l.track === track && l.phase === phase);

/** Track 1 Phase 1 board levels: the gate levels Minimalist is about. */
export const isGateLevel = (l: Pick<LevelInfo, 'track' | 'phase' | 'mode'> | undefined): boolean =>
  !!l && l.track === 'nand-to-os' && l.phase === 1 && l.mode === 'board';

const completedNow = (e: EngineEvent, id: string): boolean =>
  e.type === 'level-completed' && e.levelId === id;

const list =
  (n: number) =>
  (ctx: Ctx, key: keyof Ctx['saved']['stats']): Progress => {
    const v = ctx.saved.stats[key];
    return { value: Array.isArray(v) ? v.length : 0, target: n };
  };

function phaseClear(
  track: LevelInfo['track'],
  phase: number,
  tier: Tier,
  icon: IconName,
): AchievementDef {
  const id = `phase-${track === 'nand-to-os' ? 't1' : 't2'}-${phase}`;
  return {
    id,
    category: 'phases',
    tier,
    icon,
    progress: (ctx) => countDone(ctx, inPhase(ctx, track, phase)),
  };
}

// ---------------------------------------------------------------- the list

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // Getting started
  {
    id: 'first-light',
    category: 'start',
    tier: 'bronze',
    icon: 'bulb',
    test: (e) => e.type === 'lamp-lit',
  },
  { id: 'universal-gate', category: 'start', tier: 'bronze', icon: 'nand', level: 'meet-nand' },
  {
    id: 'chip-maker',
    category: 'start',
    tier: 'bronze',
    icon: 'chip',
    progress: (ctx) => ({ value: Math.min(ctx.session.chipCount, 1), target: 1 }),
  },
  {
    id: 'matryoshka',
    category: 'start',
    tier: 'silver',
    icon: 'nest',
    progress: (ctx) => ({ value: Math.min(ctx.session.chipDepth, 3), target: 3 }),
  },
  {
    id: 'tinkerer',
    category: 'start',
    tier: 'bronze',
    icon: 'blocks',
    progress: (ctx) => ({ value: Math.min(ctx.session.sandboxParts, 50), target: 50 }),
  },

  // Hardware (Track 1, Phases 1-5)
  {
    id: 'de-morgan',
    category: 'hardware',
    tier: 'bronze',
    icon: 'nand',
    skill: true,
    test: (e, ctx) => completedNow(e, 'or-gate') && !ctx.revealed.has('or-gate'),
  },
  {
    id: 'bus-driver',
    category: 'hardware',
    tier: 'bronze',
    icon: 'bus',
    test: (e) => e.type === 'bus-driven' && e.width >= 8,
  },
  { id: 'clockwork', category: 'hardware', tier: 'bronze', icon: 'clock', level: 'the-clock' },
  { id: 'alu', category: 'hardware', tier: 'silver', icon: 'gear', level: 'alu-8bit' },
  {
    id: 'it-multiplies',
    category: 'hardware',
    tier: 'silver',
    icon: 'cpu',
    level: 'first-program',
  },
  { id: 'pipeline', category: 'hardware', tier: 'gold', icon: 'stack', level: 'rv-pipeline' },

  // Software (Track 1, Phases 6-9)
  { id: 'recursion', category: 'software', tier: 'bronze', icon: 'spiral', level: 'recursion' },
  {
    id: 'hello-world',
    category: 'software',
    tier: 'silver',
    icon: 'terminal',
    level: 'uart-output',
  },
  { id: 'compiler-writer', category: 'software', tier: 'gold', icon: 'gear', level: 'c-compiler' },
  { id: 'it-boots', category: 'software', tier: 'silver', icon: 'power', level: 'os-bootloader' },
  { id: 'game-on', category: 'software', tier: 'gold', icon: 'flag', level: 'os-final-game' },

  // Track 2
  {
    id: 'gradient-descender',
    category: 'ml',
    tier: 'bronze',
    icon: 'slope',
    level: 'gradient-descent-1d',
  },
  { id: 'chain-reaction', category: 'ml', tier: 'silver', icon: 'graph', level: 'autograd' },
  { id: 'not-linearly-separable', category: 'ml', tier: 'silver', icon: 'graph', level: 'mlp-xor' },
  { id: 'attention', category: 'ml', tier: 'gold', icon: 'eye', level: 'transformer-block' },
  { id: 'tiny-gpt', category: 'ml', tier: 'gold', icon: 'sparkle', level: 'train-tiny-gpt' },

  // Phase clears
  phaseClear('nand-to-os', 0, 'bronze', 'bulb'),
  phaseClear('nand-to-os', 1, 'bronze', 'nand'),
  phaseClear('nand-to-os', 2, 'silver', 'gear'),
  phaseClear('nand-to-os', 3, 'silver', 'clock'),
  phaseClear('nand-to-os', 4, 'silver', 'cpu'),
  phaseClear('nand-to-os', 5, 'gold', 'cpu'),
  phaseClear('nand-to-os', 6, 'silver', 'terminal'),
  phaseClear('nand-to-os', 7, 'silver', 'bolt'),
  phaseClear('nand-to-os', 8, 'gold', 'terminal'),
  phaseClear('nand-to-os', 9, 'gold', 'kernel'),
  phaseClear('neuron-to-llm', 1, 'bronze', 'graph'),
  phaseClear('neuron-to-llm', 2, 'silver', 'slope'),
  phaseClear('neuron-to-llm', 3, 'silver', 'graph'),
  phaseClear('neuron-to-llm', 4, 'silver', 'blocks'),
  phaseClear('neuron-to-llm', 5, 'gold', 'eye'),
  phaseClear('neuron-to-llm', 6, 'gold', 'sparkle'),
  phaseClear('neuron-to-llm', 7, 'gold', 'target'),

  // Skill (never for a level whose solution was shown)
  {
    id: 'minimalist',
    category: 'skill',
    tier: 'silver',
    icon: 'feather',
    skill: true,
    test: (e, ctx) =>
      e.type === 'level-completed' && ctx.saved.stats.minimal?.includes(e.levelId) === true,
  },
  {
    id: 'optimizer',
    category: 'skill',
    tier: 'gold',
    icon: 'feather',
    skill: true,
    progress: (ctx) => {
      const gates = playable(ctx.levels).filter(isGateLevel);
      const min = new Set(ctx.saved.stats.minimal ?? []);
      return { value: gates.filter((l) => min.has(l.id)).length, target: gates.length };
    },
  },
  {
    id: 'no-hints',
    category: 'skill',
    tier: 'bronze',
    icon: 'target',
    skill: true,
    test: (e, ctx) =>
      e.type === 'level-completed' && ctx.saved.stats.noHints?.includes(e.levelId) === true,
  },
  {
    id: 'self-taught',
    category: 'skill',
    tier: 'silver',
    icon: 'target',
    skill: true,
    progress: (ctx) => list(10)(ctx, 'noHints'),
  },
  {
    id: 'clean-run',
    category: 'skill',
    tier: 'bronze',
    icon: 'check',
    skill: true,
    test: (e, ctx) =>
      e.type === 'level-completed' && ctx.saved.stats.clean?.includes(e.levelId) === true,
  },
  {
    id: 'flawless',
    category: 'skill',
    tier: 'gold',
    icon: 'check',
    skill: true,
    progress: (ctx) => list(10)(ctx, 'clean'),
  },
  {
    id: 'speedrunner',
    category: 'skill',
    tier: 'silver',
    icon: 'bolt',
    skill: true,
    test: (e, ctx) => {
      if (
        e.type !== 'level-completed' ||
        !e.first ||
        e.ms === undefined ||
        ctx.revealed.has(e.levelId)
      )
        return false;
      const l = ctx.levels.find((x) => x.id === e.levelId);
      return !!l && l.phase >= 1 && e.ms <= SPEEDRUN_MS;
    },
  },
  {
    id: 'persistence',
    category: 'skill',
    tier: 'bronze',
    icon: 'mountain',
    test: (e, ctx) => e.type === 'level-completed' && ctx.session.lastFailStreak >= 10,
  },

  // Community and tools
  {
    id: 'debugger',
    category: 'community',
    tier: 'bronze',
    icon: 'bug',
    test: (e) => e.type === 'case-debugged',
  },
  {
    id: 'sharer',
    category: 'community',
    tier: 'bronze',
    icon: 'share',
    test: (e) => e.type === 'share-created',
  },
  {
    id: 'level-designer',
    category: 'community',
    tier: 'silver',
    icon: 'pack',
    test: (e) => e.type === 'pack-exported',
  },
  {
    id: 'backed-up',
    category: 'community',
    tier: 'bronze',
    icon: 'disk',
    test: (e) => e.type === 'workspace-exported',
  },

  // Completion
  {
    id: 'warmed-up',
    category: 'completion',
    tier: 'bronze',
    icon: 'stack',
    progress: (ctx) => cap(countDone(ctx, playable(ctx.levels)), 10),
  },
  {
    id: 'nand-to-os',
    category: 'completion',
    tier: 'platinum',
    icon: 'kernel',
    progress: (ctx) =>
      countDone(
        ctx,
        playable(ctx.levels).filter((l) => l.track === 'nand-to-os'),
      ),
  },
  {
    id: 'neuron-to-llm',
    category: 'completion',
    tier: 'platinum',
    icon: 'sparkle',
    progress: (ctx) =>
      countDone(
        ctx,
        playable(ctx.levels).filter((l) => l.track === 'neuron-to-llm'),
      ),
  },
  {
    id: 'completionist',
    category: 'completion',
    tier: 'platinum',
    icon: 'crown',
    progress: (ctx) => countDone(ctx, playable(ctx.levels)),
  },

  // Secrets (just for fun: local clock and session based, never used for anything important)
  {
    id: 'night-owl',
    category: 'secret',
    tier: 'bronze',
    icon: 'moon',
    hidden: true,
    test: (e) => e.type === 'level-completed' && e.hour >= 0 && e.hour < 4,
  },
  {
    id: 'marathon',
    category: 'secret',
    tier: 'silver',
    icon: 'run',
    hidden: true,
    progress: (ctx) => ({ value: Math.min(ctx.session.firstCompletions, 5), target: 5 }),
  },
  {
    id: 'feedback-loop',
    category: 'secret',
    tier: 'bronze',
    icon: 'loop',
    hidden: true,
    test: (e) => e.type === 'unstable',
  },
  {
    id: 'magic-smoke',
    category: 'secret',
    tier: 'bronze',
    icon: 'smoke',
    hidden: true,
    test: (e) => e.type === 'contention',
  },
];

/** Speedrunner: first completion within this long of opening the level. */
export const SPEEDRUN_MS = 60_000;

function cap(p: Progress, n: number): Progress {
  return { value: Math.min(p.value, n), target: n };
}

export const achievementById = (id: string): AchievementDef | undefined =>
  ACHIEVEMENTS.find((a) => a.id === id);
