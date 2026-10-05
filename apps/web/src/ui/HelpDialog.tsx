import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { Dialog } from './Dialog';
import { IconHelp } from './icons';
import { kbd } from './shortcuts';
import './ui.css';

type Row = [label: string, keys: string[]];

function groups(): { title: string; rows: Row[] }[] {
  return [
    {
      title: t('help.groupTools'),
      rows: [
        [t('help.lock'), ['Q']],
        [t('help.select'), ['V', '1']],
        [t('help.hand'), ['H']],
        [t('help.wire'), ['W', '2']],
        [t('help.parts'), ['3 – 9']],
        [t('help.cancel'), ['Esc']],
      ],
    },
    {
      title: t('help.groupEditor'),
      rows: [
        [t('action.undo'), [kbd('Mod+Z')]],
        [t('help.redo'), [kbd('Mod+Shift+Z'), kbd('Mod+Y')]],
        [t('action.cut'), [kbd('Mod+X')]],
        [t('action.copy'), [kbd('Mod+C')]],
        [t('action.paste'), [kbd('Mod+V')]],
        [t('action.duplicate'), [kbd('Mod+D')]],
        [t('action.rotate'), ['R']],
        [t('action.rotateLeft'), [kbd('Shift+R')]],
        [t('action.flip'), ['F', kbd('Shift+H')]],
        [t('help.nudge'), ['← ↑ → ↓']],
        [t('action.delete'), ['Del', 'Backspace']],
        [t('action.selectAll'), [kbd('Mod+A')]],
      ],
    },
    {
      title: t('help.groupView'),
      rows: [
        [t('help.pan'), [t('help.panKey')]],
        [t('help.zoomIn'), [kbd('Mod+=')]],
        [t('help.zoomOut'), [kbd('Mod+-')]],
        [t('help.zoomReset'), [kbd('Mod+0')]],
        [t('help.zoomFit'), [kbd('Shift+1')]],
        [t('help.zoomSelection'), [kbd('Shift+2')]],
        [t('help.grid'), [kbd("Mod+'")]],
        [t('help.theme'), [kbd('Shift+Alt+D')]],
        [t('help.help'), ['?']],
      ],
    },
    {
      title: t('help.groupSim'),
      rows: [
        [t('help.run'), ['K']],
        [t('help.step'), ['.']],
        [t('help.tests'), [kbd('Mod+Enter')]],
      ],
    },
  ];
}

/** Help modal with every shortcut, plus a floating "?" button bottom right. */
export function HelpDialog() {
  const open = useEditor((s) => s.helpOpen);
  const set = useEditor((s) => s.set);

  return (
    <>
      <button
        type="button"
        className="island gu-island-btn gu-help-fab"
        aria-label={t('help.open')}
        title={`${t('help.open')} — ?`}
        onClick={() => set({ helpOpen: true })}
      >
        <IconHelp />
      </button>
      {open && (
        <Dialog title={t('help.title')} size="lg" closeLabel={t('help.close')} onClose={() => set({ helpOpen: false })}>
          <section className="gu-help-wiring">
            <h3>{t('help.wiringTitle')}</h3>
            <ol>
              <li>{t('help.wiring1')}</li>
              <li>{t('help.wiring2')}</li>
              <li>{t('help.wiring3')}</li>
            </ol>
          </section>
          <h3 className="gu-help-h">{t('help.shortcuts')}</h3>
          <div className="gu-help-grid">
            {groups().map((g) => (
              <section key={g.title} className="gu-help-group">
                <h4>{g.title}</h4>
                <dl>
                  {g.rows.map(([label, keys]) => (
                    <div key={label} className="gu-help-row">
                      <dt>{label}</dt>
                      <dd>
                        {keys.map((k, i) => (
                          <span key={k}>
                            {i > 0 && <span className="gu-muted"> / </span>}
                            <kbd>{k}</kbd>
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
