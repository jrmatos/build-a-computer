import { describe, expect, it } from 'vitest';
import { checkCompat, parseVersions } from './compat';

const local = { saveVersion: 2, workspaceVersion: 1 };

describe('E-DATA-09: update prompt checks save compatibility', () => {
  it('E-DATA-09: same or newer save formats are safe to reload into', () => {
    expect(checkCompat({ saveVersion: 2, workspaceVersion: 1 }, local)).toEqual({ ok: true });
    expect(checkCompat({ saveVersion: 3, workspaceVersion: 2 }, local)).toEqual({ ok: true });
  });

  it('E-DATA-09: a build with older save formats (rollback) blocks the reload', () => {
    expect(checkCompat({ saveVersion: 1, workspaceVersion: 1 }, local)).toEqual({
      ok: false,
      reason: 'older',
    });
    expect(checkCompat({ saveVersion: 2, workspaceVersion: 0 }, local)).toEqual({
      ok: false,
      reason: 'older',
    });
  });

  it('E-DATA-09: an unreadable version file does not block the reload', () => {
    expect(checkCompat(null, local)).toEqual({ ok: true });
  });

  it('parses only well-formed version files', () => {
    expect(parseVersions({ build: 'x', saveVersion: 2, workspaceVersion: 1 })).toEqual({
      saveVersion: 2,
      workspaceVersion: 1,
    });
    expect(parseVersions({ saveVersion: '2', workspaceVersion: 1 })).toBeNull();
    expect(parseVersions(null)).toBeNull();
    expect(parseVersions([])).toBeNull();
  });
});
