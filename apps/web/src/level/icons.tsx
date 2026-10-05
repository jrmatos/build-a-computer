/** Small stroke icons for the level area (Excalidraw-like 1.75px strokes). */
import type { ReactNode } from 'react';

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
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
    >
      {children}
    </svg>
  );
}

export const PowerIcon = () => (
  <Svg>
    <path d="M12 3v8" />
    <path d="M6.3 7.3a8 8 0 1 0 11.4 0" />
  </Svg>
);
export const PlayIcon = () => (
  <Svg>
    <path d="M7 5l12 7-12 7z" />
  </Svg>
);
export const PauseIcon = () => (
  <Svg>
    <path d="M8 5v14M16 5v14" />
  </Svg>
);
export const StepIcon = () => (
  <Svg>
    <path d="M5 5l9 7-9 7z" />
    <path d="M18 5v14" />
  </Svg>
);
export const ResetIcon = () => (
  <Svg>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v5h5" />
  </Svg>
);
export const LockIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const CheckIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const CrossIcon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const ChevronIcon = ({ open }: { open: boolean }) => (
  <Svg size={16}>
    <path d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
  </Svg>
);
export const MapIcon = () => (
  <Svg>
    <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" />
    <path d="M9 4v14M15 6v14" />
  </Svg>
);
export const BulbIcon = () => (
  <Svg size={16}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
  </Svg>
);
export const WarnIcon = () => (
  <Svg size={14}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
);
