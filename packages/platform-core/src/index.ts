/**
 * @build-a-computer/platform-core: the track/mode plugin registry, unlock
 * graph and progress rules, level-runner policies (tests, hints, solutions)
 * and the checker interface. Depends on schema only (ADR-010).
 */
export * from './plugins';
export * from './registry';
export * from './builtin';
export * from './progress';
export * from './policy';
export * from './checker';
