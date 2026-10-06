import { useModeUi } from '../modes';

export { SPEEDS } from './controls/BoardControls';

/** Top-right island: the level mode's controls (board simulation, or the RV32 debugger on code levels). */
export function SimControls() {
  const { Controls } = useModeUi();
  return <Controls />;
}
