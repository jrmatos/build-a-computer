/**
 * "Debug this test" on code levels: the test the debugger is set up for (its
 * registers, memory, disk and input), each expectation against the machine
 * as you step (registers, exit code, memory bytes, UART output so far), and
 * once the program ends the test's verdict with the checker's reason.
 * Run, step and breakpoints are the usual debugger controls.
 */
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { CheckDiff } from '../level/panels/CaseDiff';
import { hex32, showReg, splitUart, visible } from '../level/panels/testDiff';
import { rv, useRvDebug } from '../sim/client';
import { revealLine } from './AsmEditor';
import { mainFileFor } from './diagnostics';
import type { RvCheck, RvTestView } from '@build-a-computer/worker';

type Status = 'pass' | 'fail' | 'differs' | 'pending' | 'match';

/** How a check reads now: final once the verdict is in, otherwise live. */
function statusOf(c: RvCheck, judged: boolean): Status {
  if (judged) return c.ok ? 'pass' : 'fail';
  if (c.ok) return 'match';
  if (c.kind === 'exit' && c.actual === null) return 'pending';
  if (c.kind === 'framebuffer') return 'pending';
  if (c.kind === 'uart') {
    const s = splitUart(c.expected, c.actual).state;
    // Output only grows: once it differs (or runs past the expected text) the test fails.
    return s === 'partial' ? 'pending' : 'fail';
  }
  return 'differs';
}

const MARK: Record<Status, string> = { pass: '✓', match: '=', fail: '✗', differs: '≠', pending: '…' };

export function TestDebugPanel() {
  const level = useEditor((s) => s.level);
  const snap = useEditor((s) => s.rv);
  const testIndex = useRvDebug((s) => s.test);
  if (!level || level.mode !== 'code' || testIndex === null) return null;
  const view = snap?.test?.index === testIndex ? snap.test : undefined;
  const tests = level.tests.map((tt, i) => ({ tt, i })).filter((x) => x.tt.kind === 'riscv');
  const state = snap?.state;
  const verdict = view?.verdict;
  const running = !!state?.running;

  return (
    <section className="island code-test" aria-label={t('code.test.label')} data-testid="code-test-debug">
      <header className="code-test__head">
        <span className="code-test__kicker">{t('code.test.kicker')}</span>
        <select
          className="code-test__pick"
          value={testIndex}
          aria-label={t('code.test.pick')}
          onChange={(e) => void rv.debugTest(Number(e.target.value))}
        >
          {tests.map(({ tt, i }) => (
            <option key={i} value={i}>
              {(tt.kind === 'riscv' ? tt.name : undefined) ?? t('code.test.n', { n: i + 1 })}
            </option>
          ))}
        </select>
        <button type="button" className="code-test__icon" title={t('code.test.restartTitle')} aria-label={t('code.test.restart')} onClick={() => void rv.reset()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
        <button type="button" className="code-test__icon" title={t('code.test.close')} aria-label={t('code.test.close')} onClick={() => void rv.stopDebug()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="code-test__body">
        {!view ? (
          <p className="code-test__muted">{t('code.test.loading')}</p>
        ) : (
          <>
            <Progress view={view} instret={state?.instret ?? 0} running={running} reason={state?.reason} />
            {verdict && (
              <div className={`code-test__verdict ${verdict.pass ? 'is-pass' : 'is-fail'}`} role="status">
                <strong>{verdict.pass ? t('code.test.pass') : t('code.test.fail')}</strong>
                {!verdict.pass && verdict.message && <p className="code-test__reason">{verdict.message}</p>}
                {verdict.summary && <p className="code-test__muted">{verdict.summary}</p>}
              </div>
            )}
            {verdict && view.lineHits && view.lineHits.length > 0 && <LineHits hits={view.lineHits} file={mainFileFor(level)} />}
            <h3 className="code-test__h">{t('code.test.expect')}</h3>
            {view.checks.length === 0 ? (
              <p className="code-test__muted">{t('code.test.noChecks')}</p>
            ) : (
              <ul className="code-test__checks">
                {view.checks.map((c, k) => (
                  <CheckRow key={k} c={c} status={statusOf(c, !!verdict)} />
                ))}
              </ul>
            )}
            <Setup view={view} />
          </>
        )}
      </div>
    </section>
  );
}

function Progress({ view, instret, running, reason }: { view: RvTestView; instret: number; running: boolean; reason: string | undefined }) {
  const over = instret >= view.maxSteps;
  const what = running ? t('code.test.running') : reason === 'exit' || reason === 'trap' ? t('code.test.ended') : reason === 'ebreak' ? t('code.test.atEbreak') : t('code.test.paused');
  return (
    <p className={`code-test__progress ${over ? 'is-over' : ''}`}>
      {what} · {t('code.test.steps', { n: instret.toLocaleString(), max: view.maxSteps.toLocaleString() })}
    </p>
  );
}

/** Most lines listed under "How often each line ran". */
const MAX_HIT_LINES = 12;

/** How often each line of the player's file ran in this test (loops show up as big counts). */
function LineHits({ hits, file }: { hits: { line: number; count: number }[]; file: string }) {
  const top = Math.max(...hits.map((h) => h.count));
  // The busiest lines, shown in line order.
  const shown = [...hits]
    .sort((a, b) => b.count - a.count || a.line - b.line)
    .slice(0, MAX_HIT_LINES)
    .sort((a, b) => a.line - b.line);
  return (
    <details className="code-test__hits" open>
      <summary>{t('code.test.hits')}</summary>
      <ul>
        {shown.map((h) => (
          <li key={h.line}>
            <button type="button" className="code-test__hit" title={t('code.test.hitTitle', { line: h.line, n: h.count })} onClick={() => revealLine(h.line, file, true)}>
              <span className="code-test__hit-line">{t('code.test.hitLine', { line: h.line })}</span>
              <span className="code-test__hit-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(4, (h.count / top) * 100)}%` }} />
              </span>
              <span className="code-test__hit-n">{t(h.count === 1 ? 'code.test.once' : 'code.test.times', { n: h.count.toLocaleString() })}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function CheckRow({ c, status }: { c: RvCheck; status: Status }) {
  const mark = (
    <span className={`code-test__mark is-${status}`} title={t(`code.test.status.${status}`)} aria-label={t(`code.test.status.${status}`)}>
      {MARK[status]}
    </span>
  );
  if (c.kind === 'reg' || c.kind === 'exit') {
    const now = c.kind === 'exit' ? (c.actual === null ? '—' : showReg(c.actual)) : showReg(c.actual);
    return (
      <li className={`code-test__row is-${status}`}>
        {mark}
        <span className="code-test__name">{c.kind === 'reg' ? c.name : t('code.test.exitCode')}</span>
        <span className="code-test__val" title={t('code.test.expectedTitle')}>
          {showReg(c.expected)}
        </span>
        <span className="code-test__arrow" aria-hidden="true">
          {c.ok ? '=' : '≠'}
        </span>
        <span className={`code-test__val is-now ${c.ok ? '' : 'is-off'}`} title={t('code.test.nowTitle')}>
          {now}
        </span>
        {c.kind === 'reg' && <span className="code-test__hex">{showReg(c.actual, true)}</span>}
      </li>
    );
  }
  if (c.kind === 'uart') {
    const sp = splitUart(c.expected, c.actual);
    const off = c.offset ?? 0;
    return (
      <li className={`code-test__row is-block is-${status}`}>
        <div className="code-test__line">
          {mark}
          <span className="code-test__name">{t('code.test.uart')}</span>
          <span className="code-test__muted">{t(`code.test.uartState.${sp.state}`, { n: c.firstDiff })}</span>
        </div>
        <div className="code-test__uart">
          <span className="code-test__k">{t('code.test.expected')}</span>
          <pre>
            {off > 0 && '…'}
            {visible(sp.same)}
            <mark className="cd-want">{visible(sp.want)}</mark>
          </pre>
          <span className="code-test__k">{t('code.test.soFar')}</span>
          <pre>
            {off > 0 && '…'}
            {visible(sp.same)}
            {sp.got && <mark className="cd-got">{visible(sp.got)}</mark>}
            {status === 'pending' && <span className="code-test__caret" aria-hidden="true" />}
          </pre>
        </div>
      </li>
    );
  }
  return (
    <li className={`code-test__row is-block is-${status}`}>
      <div className="code-test__line">
        {mark}
        {c.kind === 'memory' ? (
          <span className="code-test__name">{t('code.test.memory', { addr: hex32(c.addr) })}</span>
        ) : (
          <span className="code-test__name">{t('code.test.screen')}</span>
        )}
      </div>
      {c.kind === 'memory' ? <CheckDiff c={c} /> : <span className="code-test__muted">{c.ok ? t('code.test.screenOk') : t('code.test.screenOff')}</span>}
    </li>
  );
}

/** What the test sets before the first instruction. */
function Setup({ view }: { view: RvTestView }) {
  const regs = Object.entries(view.setup.regs ?? {});
  const mem = view.setup.memory ?? [];
  const disk = view.setup.disk ?? [];
  const bytes = (hex: string) => hex.replace(/0x/gi, '').replace(/[\s,_]/g, '').length / 2;
  if (!regs.length && !mem.length && !disk.length && !view.input) return <p className="code-test__muted code-test__setup-none">{t('code.test.noSetup')}</p>;
  return (
    <details className="code-test__setup" open>
      <summary>{t('code.test.setup')}</summary>
      <ul>
        {regs.map(([k, v]) => (
          <li key={k}>
            <code>
              {k} = {showReg(v)}
            </code>
          </li>
        ))}
        {mem.map((m, i) => (
          <li key={`m${i}`}>
            <code>{t('code.test.memPoke', { addr: hex32(m.addr), n: bytes(m.hex) })}</code>
          </li>
        ))}
        {disk.map((d, i) => (
          <li key={`d${i}`}>
            <code>{t('code.test.diskPoke', { sector: d.sector, n: bytes(d.hex) })}</code>
          </li>
        ))}
        {view.input && (
          <li>
            {t('code.test.input')} <code className="code-test__input">{JSON.stringify(view.input.length > 120 ? `${view.input.slice(0, 120)}…` : view.input)}</code>
          </li>
        )}
      </ul>
    </details>
  );
}
