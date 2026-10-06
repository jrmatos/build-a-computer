import { describe, expect, it } from 'vitest';
import { LEVELS } from '@build-a-computer/content/full';
import { modeOf, trackOf } from '@build-a-computer/platform-core';

describe('track and mode plugins (PLAT-01)', () => {
  it('every content level uses a mode its track declares, and only test kinds its mode runs', () => {
    for (const l of LEVELS) {
      expect(trackOf(l).modes, l.id).toContain(l.mode);
      for (const t of l.tests) expect(modeOf(l).testKinds, `${l.id}: ${t.kind}`).toContain(t.kind);
    }
  });
});
