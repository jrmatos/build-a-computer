/**
 * Inline SVG icons, stroke based like lucide. Decorative by default
 * (aria-hidden); the button that holds an icon carries the label.
 */
import type { ReactNode, SVGProps } from 'react';
import type { PartType } from '@build-a-computer/schema';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(children: ReactNode) {
  return function Icon({ size = 18, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {children}
      </svg>
    );
  };
}

export const IconLock = make(
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
);
export const IconUnlock = make(
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 7.5-1.9" />
  </>,
);
export const IconPointer = make(
  <>
    <path d="M6 3l12 7.5-5.2 1.3L10 17z" />
    <path d="M12.8 11.8l4.2 6.2" />
  </>,
);
export const IconHand = make(
  <>
    <path d="M18 11V6a2 2 0 0 0-4 0v1" />
    <path d="M14 10V4a2 2 0 0 0-4 0v2" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" />
  </>,
);
export const IconWire = make(
  <>
    <circle cx="5" cy="18" r="2" />
    <circle cx="19" cy="6" r="2" />
    <path d="M7 18h5V6h5" />
  </>,
);
export const IconLibrary = make(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <path d="M17.5 14v7M14 17.5h7" />
  </>,
);
export const IconMenu = make(<path d="M4 6h16M4 12h16M4 18h16" />);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconMinus = make(<path d="M5 12h14" />);
export const IconUndo = make(
  <>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>,
);
export const IconRedo = make(
  <>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </>,
);
export const IconClose = make(<path d="M18 6L6 18M6 6l12 12" />);
export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>,
);
export const IconRotateCw = make(
  <>
    <path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" />
    <path d="M21 3v5h-5" />
  </>,
);
export const IconRotateCcw = make(
  <>
    <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
    <path d="M3 3v5h5" />
  </>,
);
export const IconFlip = make(
  <>
    <path d="M12 3v18" strokeDasharray="2 2.5" />
    <path d="M8 7L3 17h5z" />
    <path d="M16 7l5 10h-5z" />
  </>,
);
export const IconDuplicate = make(
  <>
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M4 16a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h10a1 1 0 0 1 1 1" />
  </>,
);
export const IconCopy = IconDuplicate;
export const IconTrash = make(
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 1H8a2 2 0 0 1-2-1L5 6" />
    <path d="M10 11v6M14 11v6" />
  </>,
);
export const IconScissors = make(
  <>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />
  </>,
);
export const IconClipboard = make(
  <>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  </>,
);
export const IconSelectAll = make(
  <>
    <path d="M5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M21 19a2 2 0 0 1-2 2M5 21a2 2 0 0 1-2-2" />
    <path d="M9 3h1M14 3h1M9 21h1M14 21h1M3 9v1M3 14v1M21 9v1M21 14v1" />
    <rect x="8" y="8" width="8" height="8" rx="1" />
  </>,
);
export const IconFit = make(
  <>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    <rect x="8" y="8" width="8" height="8" rx="1" />
  </>,
);
export const IconFolderOpen = make(
  <path d="M6 14l1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6A2 2 0 0 1 18.5 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2" />,
);
export const IconDownload = make(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5M12 15V3" />
  </>,
);
export const IconReset = make(
  <>
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M8 16H3v5" />
  </>,
);
export const IconLevels = make(
  <>
    <path d="M12 2l9 5-9 5-9-5z" />
    <path d="M3 12l9 5 9-5" />
    <path d="M3 17l9 5 9-5" />
  </>,
);
export const IconSun = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>,
);
export const IconMoon = make(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);
export const IconGrid = make(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </>,
);
export const IconHelp = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </>,
);
export const IconChevronDown = make(<path d="M6 9l6 6 6-6" />);
export const IconMore = make(
  <>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </>,
);
export const IconCheck = make(<path d="M20 6L9 17l-5-5" />);
export const IconInfo = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </>,
);
export const IconAlert = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4M12 16h.01" />
  </>,
);
export const IconChip = make(
  <>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
  </>,
);

/* ------------------------------------------------------------------ */
/* Gate symbols for parts. Drawn in a 32 x 24 box, inputs left, output right. */

const leads2 = <path d="M2 8h7M2 16h7" />;
const andBody = <path d="M9 4h7a8 8 0 0 1 0 16H9z" />;
const orBody = <path d="M8 4h5c5 0 9 4 11 8-2 4-6 8-11 8H8c2.5-5 2.5-11 0-16z" />;
const xorTail = <path d="M5 4c2.5 5 2.5 11 0 16" />;
const bubble = (cx: number) => <circle cx={cx} cy="12" r="2" />;

const SYMBOLS: Record<PartType, ReactNode> = {
  nand: (
    <>
      {leads2}
      {andBody}
      {bubble(26)}
      <path d="M28 12h2" />
    </>
  ),
  and: (
    <>
      {leads2}
      {andBody}
      <path d="M24 12h6" />
    </>
  ),
  or: (
    <>
      <path d="M2 8h8M2 16h8" />
      {orBody}
      <path d="M24 12h6" />
    </>
  ),
  nor: (
    <>
      <path d="M2 8h8M2 16h8" />
      {orBody}
      {bubble(26)}
      <path d="M28 12h2" />
    </>
  ),
  xor: (
    <>
      <path d="M2 8h5M2 16h5" />
      {xorTail}
      {orBody}
      <path d="M24 12h6" />
    </>
  ),
  xnor: (
    <>
      <path d="M2 8h5M2 16h5" />
      {xorTail}
      {orBody}
      {bubble(26)}
      <path d="M28 12h2" />
    </>
  ),
  not: (
    <>
      <path d="M2 12h7" />
      <path d="M9 5l12 7-12 7z" />
      {bubble(23)}
      <path d="M25 12h5" />
    </>
  ),
  switch: (
    <>
      <rect x="5" y="7" width="18" height="10" rx="5" />
      <circle cx="18" cy="12" r="3" fill="currentColor" />
      <path d="M23 12h7" />
    </>
  ),
  lamp: (
    <>
      <path d="M2 12h6" />
      <circle cx="16" cy="12" r="6" />
      <path d="M12 8l8 8M20 8l-8 8" />
    </>
  ),
  clock: <path d="M3 16h4V8h5v8h5V8h5v8h5" />,
  dff: (
    <>
      <rect x="8" y="3" width="16" height="18" rx="1.5" />
      <path d="M2 8h6M2 16h6M24 12h6" />
      <path d="M8 13.5l3 2.5-3 2.5" />
      <text x="12.5" y="10.5" fontSize="6" fill="currentColor" stroke="none" fontFamily="var(--font-mono)">
        D
      </text>
    </>
  ),
  button: (
    <>
      <circle cx="14" cy="12" r="7" />
      <circle cx="14" cy="12" r="3.25" fill="currentColor" />
      <path d="M21 12h9" />
    </>
  ),
  const: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M10.5 10l2-1.5v7.5" />
      <path d="M20 12h10" />
    </>
  ),
  buffer: (
    <>
      <path d="M2 12h7" />
      <path d="M9 5l13 7-13 7z" />
      <path d="M22 12h8" />
    </>
  ),
  tristate: (
    <>
      <path d="M2 10h7" />
      <path d="M9 3l13 7-13 7z" />
      <path d="M22 10h8" />
      <path d="M15.5 22v-8.5" />
    </>
  ),
  splitter: (
    <>
      <path d="M2 12h9" strokeWidth={3.25} strokeLinecap="butt" />
      <path d="M12 3v18" strokeWidth={3} />
      <path d="M13.5 5h15M13.5 9.7h15M13.5 14.3h15M13.5 19h15" />
    </>
  ),
  joiner: (
    <>
      <path d="M3.5 5h15M3.5 9.7h15M3.5 14.3h15M3.5 19h15" />
      <path d="M20 3v18" strokeWidth={3} />
      <path d="M21 12h9" strokeWidth={3.25} strokeLinecap="butt" />
    </>
  ),
  register: (
    <>
      <rect x="7" y="3" width="18" height="18" rx="1.5" />
      <path d="M2 7h5M2 12h5M25 12h5" />
      <path d="M7 15.5l3 2.5-3 2.5" />
      <rect x="11.5" y="9.5" width="10" height="5" rx="1" fill="currentColor" fillOpacity={0.25} />
    </>
  ),
  counter: (
    <>
      <rect x="7" y="3" width="18" height="18" rx="1.5" />
      <path d="M2 7h5M25 12h5" />
      <path d="M7 15.5l3 2.5-3 2.5" />
      <path d="M13 12h5M15.5 9.5v5M20 9l1.5-1v6.5" />
    </>
  ),
  ram: (
    <>
      <rect x="7" y="3" width="18" height="18" rx="1.5" />
      <path d="M7 9h18M7 15h18M16 3v18" />
      <path d="M2 7h5M2 12h5M2 17h5M25 12h5" />
    </>
  ),
  rom: (
    <>
      <rect x="7" y="3" width="18" height="18" rx="1.5" />
      <path d="M7 7.5h18M7 12h18M7 16.5h18" />
      <path d="M2 12h5M25 12h5" />
    </>
  ),
  mux: (
    <>
      <path d="M9 2l13 4.5v11L9 22z" />
      <path d="M2 8h7M2 16h7M22 12h8" />
      <path d="M15.5 23v-3" />
    </>
  ),
  decoder: (
    <>
      <path d="M9 6.5L22 2v20L9 17.5z" />
      <path d="M2 12h7M22 5.5h8M22 10h8M22 14h8M22 18.5h8" />
    </>
  ),
  adder: (
    <>
      <rect x="7" y="3" width="18" height="18" rx="1.5" />
      <path d="M16 8v8M12 12h8" />
      <path d="M2 7h5M2 17h5M25 12h5" />
    </>
  ),
  alu: (
    <>
      <path d="M8 2l15 5v10L8 22v-7.5l3.5-2.5L8 9.5z" />
      <path d="M2 6h6M2 18h6M23 12h7" />
    </>
  ),
  // Phase 5 RISC-V blocks: placeholders until the RV blocks agent draws them.
  regfile: (
    <>
      <rect x="7" y="3" width="18" height="18" rx="1.5" />
      <path d="M2 7h5M2 12h5M25 9h5M25 15h5M10 8h12M10 12h12M10 16h12" />
    </>
  ),
  immgen: (
    <>
      <rect x="7" y="5" width="18" height="14" rx="1.5" />
      <path d="M2 12h5M25 12h5" />
    </>
  ),
  rvalu: (
    <>
      <path d="M8 2l15 5v10L8 22v-7.5l3.5-2.5L8 9.5z" />
      <path d="M2 6h6M2 18h6M23 12h7" />
    </>
  ),
  branchcmp: (
    <>
      <rect x="7" y="5" width="18" height="14" rx="1.5" />
      <path d="M2 9h5M2 15h5M25 12h5" />
    </>
  ),
  lsu: (
    <>
      <rect x="7" y="3" width="18" height="18" rx="1.5" />
      <path d="M2 8h5M2 16h5M25 8h5M25 16h5" />
    </>
  ),
  chip: (
    <>
      <rect x="7" y="3" width="18" height="18" rx="3" fill="currentColor" fillOpacity={0.18} />
      <path d="M2 7.5h5M2 12h5M2 16.5h5M25 9h5M25 15h5" />
      <path d="M12 3v2.5M20 3v2.5" />
    </>
  ),
};

/** A small schematic symbol for a part, for toolbar buttons and library tiles. */
export function PartSymbol({ type, size = 22, ...rest }: SVGProps<SVGSVGElement> & { type: PartType; size?: number }) {
  return (
    <svg
      width={(size * 32) / 24}
      height={size}
      viewBox="0 0 32 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {SYMBOLS[type]}
    </svg>
  );
}
