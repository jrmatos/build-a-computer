import type { DragEvent, ReactNode } from 'react';
import type { PartType } from '@ground-up/schema';
import { useEditor, type Tool } from '../editor/store';
import { t } from '../i18n';
import { IconHand, IconLibrary, IconLock, IconMore, IconPointer, IconUnlock, IconWire, PartSymbol } from './icons';
import { PART_DRAG_MIME, paletteKeys, paletteParts } from './shortcuts';
import './ui.css';

const MAX_INLINE = 7;

/** Start dragging a part onto the canvas; the canvas handles the drop. */
export function startPartDrag(e: DragEvent, type: PartType): void {
  e.dataTransfer.setData(PART_DRAG_MIME, type);
  e.dataTransfer.setData('text/plain', type);
  e.dataTransfer.effectAllowed = 'copy';
}

/** Top-center tool island, Excalidraw style. */
export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const locked = useEditor((s) => s.toolLocked);
  const level = useEditor((s) => s.level);
  const libraryOpen = useEditor((s) => s.libraryOpen);
  const readOnly = useEditor((s) => s.readOnly);
  const setTool = useEditor((s) => s.setTool);
  const set = useEditor((s) => s.set);

  const parts = paletteParts(level);
  const keys = paletteKeys(level);
  const inline = parts.slice(0, MAX_INLINE);
  const overflow = parts.length > MAX_INLINE;

  return (
    <div className="island gu-toolbar" role="toolbar" aria-label={t('toolbar.label')}>
      <ToolButton
        label={t('tool.lock')}
        shortcut="Q"
        pressed={locked}
        onClick={() => set({ toolLocked: !locked })}
        className="gu-tool--lock"
      >
        {locked ? <IconLock /> : <IconUnlock />}
      </ToolButton>
      <span className="gu-divider" aria-hidden="true" />
      <ToolButton label={t('tool.select')} shortcut="V" badge="1" pressed={tool === 'select'} onClick={() => setTool('select')}>
        <IconPointer />
      </ToolButton>
      <ToolButton label={t('tool.hand')} shortcut="H" pressed={tool === 'hand'} onClick={() => setTool('hand')}>
        <IconHand />
      </ToolButton>
      <ToolButton
        label={t('tool.wire')}
        shortcut="W"
        badge="2"
        pressed={tool === 'wire'}
        disabled={readOnly}
        onClick={() => setTool('wire')}
      >
        <IconWire />
      </ToolButton>
      {inline.length > 0 && <span className="gu-divider" aria-hidden="true" />}
      {inline.map((type) => {
        const key = keys.get(type);
        const placeTool: Tool = `place:${type}`;
        return (
          <ToolButton
            key={type}
            label={t('tool.place', { part: t(`part.${type}`) })}
            shortcut={key ? String(key) : undefined}
            badge={key ? String(key) : undefined}
            pressed={tool === placeTool}
            disabled={readOnly}
            onClick={() => setTool(placeTool)}
            draggable={!readOnly}
            onDragStart={(e) => startPartDrag(e, type)}
            className="gu-tool--part"
          >
            <PartSymbol type={type} size={18} />
          </ToolButton>
        );
      })}
      {overflow && (
        <ToolButton label={t('tool.more')} pressed={false} onClick={() => set({ libraryOpen: true })}>
          <IconMore />
        </ToolButton>
      )}
      <span className="gu-divider" aria-hidden="true" />
      <ToolButton label={t('tool.library')} pressed={libraryOpen} onClick={() => set({ libraryOpen: !libraryOpen })}>
        <IconLibrary />
      </ToolButton>
    </div>
  );
}

interface ToolButtonProps {
  label: string;
  shortcut?: string | undefined;
  badge?: string | undefined;
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  className?: string;
  children: ReactNode;
}

function ToolButton({ label, shortcut, badge, pressed, disabled, onClick, draggable, onDragStart, className, children }: ToolButtonProps) {
  const title = shortcut ? t('tool.shortcut', { name: label, key: badge && badge !== shortcut ? `${shortcut} / ${badge}` : shortcut }) : label;
  return (
    <button
      type="button"
      className={`gu-tool${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      title={title}
      disabled={disabled}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {children}
      {badge && <span className="gu-tool__badge">{badge}</span>}
    </button>
  );
}
