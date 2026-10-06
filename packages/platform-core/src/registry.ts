import type { Level } from '@build-a-computer/schema';
import type { LevelMode, ModePlugin, TestKind, TestKindSpec, TrackId, TrackPlugin } from './plugins';

/**
 * Track, mode and test-kind registry. The app and the worker use the default
 * registry (`registry`, built-ins registered in builtin.ts); tests and future
 * tracks can build their own.
 */
export class Registry {
  private readonly tracks = new Map<TrackId, TrackPlugin>();
  private readonly modes = new Map<LevelMode, ModePlugin>();
  private readonly kinds = new Map<TestKind, TestKindSpec>();

  /** Add a track. Its modes must be registered first. */
  registerTrack(track: TrackPlugin): this {
    if (this.tracks.has(track.id)) throw new Error(`Track '${track.id}' is already registered.`);
    for (const m of track.modes) if (!this.modes.has(m)) throw new Error(`Track '${track.id}' uses unknown mode '${m}'.`);
    this.tracks.set(track.id, track);
    return this;
  }

  /** Add a mode with the test kinds it introduces. */
  registerMode(mode: ModePlugin, kinds: readonly Omit<TestKindSpec, 'mode'>[] = []): this {
    if (this.modes.has(mode.id)) throw new Error(`Mode '${mode.id}' is already registered.`);
    for (const k of kinds) if (this.kinds.has(k.kind)) throw new Error(`Test kind '${k.kind}' is already registered.`);
    this.modes.set(mode.id, mode);
    for (const k of kinds) this.kinds.set(k.kind, { ...k, mode: mode.id });
    return this;
  }

  track(id: TrackId): TrackPlugin {
    const t = this.tracks.get(id);
    if (!t) throw new Error(`Unknown track '${id}'.`);
    return t;
  }

  /** A level's mode plugin (levels without a mode are board levels). */
  mode(of: LevelMode | Pick<Level, 'mode'> | null | undefined): ModePlugin {
    const id: LevelMode = (typeof of === 'string' ? of : of?.mode) ?? 'board';
    const m = this.modes.get(id);
    if (!m) throw new Error(`Unknown level mode '${id}'.`);
    return m;
  }

  testKind(kind: TestKind): TestKindSpec {
    const k = this.kinds.get(kind);
    if (!k) throw new Error(`Unknown test kind '${kind}'.`);
    return k;
  }

  allTracks(): TrackPlugin[] {
    return [...this.tracks.values()];
  }

  allModes(): ModePlugin[] {
    return [...this.modes.values()];
  }

  /** Every registered test kind, in registration order. */
  allTestKinds(): TestKind[] {
    return [...this.kinds.keys()];
  }
}
