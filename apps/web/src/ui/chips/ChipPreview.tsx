import type { ChipDef, Part } from '@build-a-computer/schema';
import { geomOf, getChipRegistry, setChipRegistry, type PartGeom } from '../../editor/parts';

/** Geometry of a chip tile, using the editor's own layout (geomOf) even for a draft definition. */
export function chipGeom(def: ChipDef): PartGeom {
  const part: Part = {
    id: `preview-${def.id}`,
    type: 'chip',
    chip: def.id,
    x: 0,
    y: 0,
    rot: 0,
    flip: false,
  };
  const reg = getChipRegistry();
  if (reg[def.id] === def) return geomOf(part);
  // Draft: register it just long enough to lay it out (synchronous, nothing renders in between).
  setChipRegistry({ ...reg, [def.id]: def });
  try {
    return geomOf(part);
  } finally {
    setChipRegistry(reg);
  }
}

const CELL = 16;

/** SVG picture of a chip tile: colored body, name, pins with their names. */
export function ChipPreview({
  def,
  maxWidth,
  maxHeight,
  maxScale = 1,
  compact = false,
}: {
  def: ChipDef;
  maxWidth?: number;
  maxHeight?: number;
  maxScale?: number;
  compact?: boolean;
}) {
  const g = chipGeom(def);
  const pad = 1.2;
  const x0 = g.body.x - pad;
  const y0 = g.body.y - 0.6;
  const w = g.body.w + pad * 2;
  const h = g.body.h + 1.2;
  const color = def.color ?? '#4c6ef5';
  let width = w * CELL;
  let height = h * CELL;
  const k = Math.min(maxScale, (maxWidth ?? width) / width, (maxHeight ?? height) / height);
  width *= k;
  height *= k;
  return (
    <svg
      className="gu-chip-preview"
      width={width}
      height={height}
      viewBox={`${x0 * CELL} ${y0 * CELL} ${w * CELL} ${h * CELL}`}
      role="img"
      aria-label={def.name}
    >
      {g.pins.map((p) => (
        <line
          key={`s-${p.output ? 'o' : 'i'}-${p.name}`}
          x1={p.x * CELL}
          y1={p.y * CELL}
          x2={(p.x + p.dir[0] * 0.6) * CELL}
          y2={(p.y + p.dir[1] * 0.6) * CELL}
          stroke="#aab2c0"
          strokeWidth={p.width > 1 ? 3 : 1.6}
        />
      ))}
      <rect
        x={g.body.x * CELL}
        y={g.body.y * CELL}
        width={g.body.w * CELL}
        height={g.body.h * CELL}
        rx={5}
        fill="#23262e"
        stroke={color}
        strokeWidth={1.5}
      />
      <rect
        x={g.body.x * CELL}
        y={g.body.y * CELL}
        width={g.body.w * CELL}
        height={CELL * 0.85}
        rx={5}
        fill={color}
      />
      {!compact && (
        <text
          x={(g.body.x + g.body.w / 2) * CELL}
          y={(g.body.y + 0.43) * CELL}
          dy="0.35em"
          textAnchor="middle"
          fontSize={9.5}
          fontWeight={600}
          fill="#fff"
          fontFamily="var(--font-ui)"
        >
          {def.name.length > 14 ? `${def.name.slice(0, 13)}…` : def.name}
        </text>
      )}
      {!compact &&
        g.pins.map((p) => (
          <g key={`l-${p.output ? 'o' : 'i'}-${p.name}`}>
            <circle cx={p.x * CELL} cy={p.y * CELL} r={2.6} fill="#e9ecf2" />
            <text
              x={(p.x - p.dir[0] * 0.35) * CELL}
              y={p.y * CELL}
              dy="0.35em"
              textAnchor={p.output ? 'end' : 'start'}
              fontSize={9}
              fill="#c5cbd6"
              fontFamily="var(--font-mono)"
            >
              {p.name.length > 10 ? `${p.name.slice(0, 9)}…` : p.name}
            </text>
          </g>
        ))}
    </svg>
  );
}
