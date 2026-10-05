import { Fragment, useEffect } from 'react';
import { exitChip, installChipKeys } from '../editor/chips';
import { useEditor } from '../editor/store';
import { t } from '../i18n';
import { ChipDialogs } from './chips/ChipDialogs';
import { installChipDrop } from './chips/drop';
import { IconChip } from './icons';
import './chips/chips.css';

/**
 * Top-left island while editing inside a chip: "Level ▸ Adder8 ▸ FullAdder".
 * Click a crumb to go back to that depth; Esc leaves one level (CHIP-02).
 * Also hosts the chip dialogs and keyboard handling.
 */
export function Breadcrumbs() {
  const stack = useEditor((s) => s.editStack);
  const chips = useEditor((s) => s.chips);
  const level = useEditor((s) => s.level);

  useEffect(() => {
    const a = installChipKeys();
    const b = installChipDrop();
    return () => {
      a();
      b();
    };
  }, []);

  const levelName = level?.title ?? t('chips.crumbs.level');
  const names = [levelName, ...stack.map((f) => chips[f.chipId]?.name ?? f.chipId)];
  return (
    <>
      <ChipDialogs />
      {stack.length > 0 && (
        <nav
          className="island gu-crumbs"
          aria-label={t('chips.crumbs.label')}
          title={t('chips.crumbs.editing')}
        >
          <ol>
            {names.map((name, depth) => {
              const last = depth === names.length - 1;
              const color = depth > 0 ? chips[stack[depth - 1]!.chipId]?.color : undefined;
              return (
                <Fragment key={depth}>
                  {depth > 0 && (
                    <li aria-hidden="true" className="gu-crumbs__sep">
                      ▸
                    </li>
                  )}
                  <li>
                    {last ? (
                      <span className="gu-crumbs__item is-current" aria-current="location">
                        {depth > 0 && <IconChip size={14} style={color ? { color } : undefined} />}
                        {name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="gu-crumbs__item"
                        title={t('chips.crumbs.exit', { name })}
                        onClick={() => exitChip(depth)}
                      >
                        {depth > 0 && <IconChip size={14} style={color ? { color } : undefined} />}
                        {name}
                      </button>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </nav>
      )}
    </>
  );
}
