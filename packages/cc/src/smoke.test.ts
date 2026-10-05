import { expect, it } from 'vitest';
import { run } from './test/harness';
it('hello', () => {
  const r = run(`int puts(const char*); int main(void) { puts("hello"); return 42; }`);
  console.log(r.asm);
  expect(r.uart).toBe('hello\n');
  expect(r.exitCode).toBe(42);
});
