/**
 * The reference kernel is one source tree with feature switches
 * (`#ifdef CONFIG_VM` … `#endif`). Each level ships the kernel as it is at
 * that stage: `specialize` keeps the code of the enabled features, drops the
 * rest, and removes the CONFIG_ lines themselves, so players read plain C
 * with no switches. Other preprocessor lines (include guards) pass through.
 */

/** Kernel features, in the order the levels add them. */
export const FEATURES = ['SYSCALL', 'PROC', 'TIMER', 'VM', 'FS', 'USERBOOT'] as const;
export type Feature = (typeof FEATURES)[number];

const COND = /^\s*#\s*(ifdef|ifndef)\s+CONFIG_([A-Z0-9_]+)\s*$/;
const ELSE = /^\s*#\s*else\b/;
const ENDIF = /^\s*#\s*endif\b/;
const OTHER_IF = /^\s*#\s*if/;

interface Frame {
  /** True for a CONFIG_ conditional (its lines are removed). */
  config: boolean;
  /** Whether the current branch's lines are kept (ignoring outer frames). */
  on: boolean;
}

/**
 * Evaluate the CONFIG_ conditionals in `text` for `features` (unknown
 * CONFIG_ names count as off). Throws on unbalanced conditionals.
 * Runs of blank lines left behind collapse to one.
 */
export function specialize(
  text: string,
  features: readonly Feature[] | ReadonlySet<string>,
): string {
  const on = new Set<string>(features);
  const stack: Frame[] = [];
  const out: string[] = [];
  const live = (): boolean => stack.every((f) => f.on);
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const cond = COND.exec(line);
    if (cond) {
      const has = on.has(cond[2]!);
      stack.push({ config: true, on: cond[1] === 'ifdef' ? has : !has });
      return;
    }
    if (OTHER_IF.test(line)) {
      stack.push({ config: false, on: true });
      if (live()) out.push(line);
      return;
    }
    if (ELSE.test(line)) {
      const top = stack.at(-1);
      if (!top) throw new Error(`line ${i + 1}: #else without #if`);
      if (top.config) {
        top.on = !top.on;
        return;
      }
      if (live()) out.push(line);
      return;
    }
    if (ENDIF.test(line)) {
      const top = stack.pop();
      if (!top) throw new Error(`line ${i + 1}: #endif without #if`);
      if (!top.config && live()) out.push(line);
      return;
    }
    if (live()) out.push(line);
  });
  if (stack.length) throw new Error('unterminated #if');
  const result: string[] = [];
  for (const line of out) {
    if (line.trim() === '' && result.length && result.at(-1)!.trim() === '') continue;
    result.push(line);
  }
  return result.join('\n');
}
