import { describe, expect, it } from 'vitest';
import { levelFromUrl } from './persist';

describe('level routing', () => {
  it('reads ?level= and hash forms', () => {
    expect(levelFromUrl('http://x/?level=not-gate')).toBe('not-gate');
    expect(levelFromUrl('http://x/#level=and-gate')).toBe('and-gate');
    expect(levelFromUrl('http://x/#/level/or-gate')).toBe('or-gate');
    expect(levelFromUrl('http://x/')).toBeNull();
  });
});
