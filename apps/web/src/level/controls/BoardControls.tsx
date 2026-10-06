import { useEditor } from '../../editor/store';
import { t } from '../../i18n';
import { sim } from '../../sim/client';
import { PauseIcon, PlayIcon, PowerIcon, ResetIcon, StepIcon, WarnIcon } from '../icons';
import { toggleRun, useSimShortcuts } from '../shortcuts';
import '../level.css';
import '../panels/panels.css';

export const SPEEDS = [1, 4, 16, 64, 1000] as const;
const speedLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k Hz` : `${hz} Hz`);

/** Power, reset, run/pause, step, speed, tick counter and clock light. */
export function BoardControls() {
  useSimShortcuts();
  const snapshot = useEditor((s) => s.snapshot);
  const speedHz = useEditor((s) => s.speedHz);
  const powered = snapshot?.powered ?? false;
  const running = snapshot?.running ?? false;
  const unstable = !!snapshot && !snapshot.stable;

  const setSpeed = (hz: number) => {
    useEditor.getState().set({ speedHz: hz });
    if (running) void sim.run(hz);
  };

  return (
    <div className="island sim-controls" role="toolbar" aria-label={t('level.sim.label')}>
      <button
        type="button"
        className={`lv-icon-btn power ${powered ? 'is-on' : ''}`}
        aria-pressed={powered}
        title={powered ? t('level.sim.powerOff') : t('level.sim.powerOn')}
        aria-label={powered ? t('level.sim.powerOff') : t('level.sim.powerOn')}
        onClick={() => void sim.power(!powered)}
      >
        <PowerIcon />
        <span className={`power-light ${powered ? 'is-on' : ''}`} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="lv-icon-btn"
        title={t('level.sim.reset')}
        aria-label={t('level.sim.reset')}
        onClick={() => void sim.reset()}
      >
        <ResetIcon />
      </button>
      <span className="sim-sep" aria-hidden="true" />
      <button
        type="button"
        className={`lv-icon-btn ${running ? 'is-active' : ''}`}
        aria-pressed={running}
        title={`${running ? t('level.sim.pause') : t('level.sim.run')} — K`}
        aria-label={running ? t('level.sim.pause') : t('level.sim.run')}
        onClick={toggleRun}
      >
        {running ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button
        type="button"
        className="lv-icon-btn"
        title={`${t('level.sim.step')} — .`}
        aria-label={t('level.sim.step')}
        onClick={() => void sim.step(1)}
      >
        <StepIcon />
      </button>
      <select
        className="sim-speed"
        value={speedHz}
        aria-label={t('level.sim.speed')}
        title={t('level.sim.speed')}
        onChange={(e) => setSpeed(Number(e.target.value))}
      >
        {(SPEEDS as readonly number[]).includes(speedHz) ? null : <option value={speedHz}>{speedLabel(speedHz)}</option>}
        {SPEEDS.map((hz) => (
          <option key={hz} value={hz}>
            {speedLabel(hz)}
          </option>
        ))}
      </select>
      <span className="sim-sep" aria-hidden="true" />
      <span className="sim-readout" title={t('level.sim.clock')}>
        <span className={`clock-light ${snapshot?.clock ? 'is-high' : ''}`} aria-hidden="true" />
        <span className="visually-hidden">
          {t('level.sim.clock')}: {snapshot?.clock ?? 0}
        </span>
        <span className="sim-ticks" aria-label={t('level.sim.ticks')}>
          {(snapshot?.ticks ?? 0).toLocaleString()}
        </span>
      </span>
      {unstable && (
        <span className="lv-chip warn" role="status" title={t('level.sim.unstableHelp')}>
          <WarnIcon />
          {t('level.sim.unstable')}
        </span>
      )}
    </div>
  );
}
