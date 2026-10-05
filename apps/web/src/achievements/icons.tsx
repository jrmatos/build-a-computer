/**
 * Achievement icons: one 24x24 line set (1.75 stroke, round joins,
 * currentColor), drawn to sit inside a round medal.
 */
import type { ReactNode } from 'react';
import type { IconName } from './definitions';

const PATHS: Record<IconName, ReactNode> = {
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z" />
    </>
  ),
  nand: (
    <>
      <path d="M5 6h6a6 6 0 0 1 0 12H5Z" />
      <circle cx="19" cy="12" r="1.8" />
      <path d="M2 9h3M2 15h3" />
    </>
  ),
  chip: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </>
  ),
  nest: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <rect x="10.5" y="10.5" width="3" height="3" rx="0.8" />
    </>
  ),
  blocks: (
    <>
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
      <rect x="8" y="3" width="8" height="8" rx="1.5" />
    </>
  ),
  bus: (
    <>
      <path d="M3 7h18M3 12h18M3 17h18" />
      <path d="M7 5v4M12 10v4M17 15v4" />
    </>
  ),
  clock: (
    <>
      <path d="M3 16h3V8h4v8h4V8h4v8h3" />
    </>
  ),
  cpu: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M9 9h6v6H9Z" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M12 15h5" />
    </>
  ),
  spiral: (
    <path d="M12 12a1.5 1.5 0 1 1 1.5 1.5A3 3 0 0 1 10.5 10.5 4.5 4.5 0 0 1 15 6a6 6 0 0 1 6 6 7.5 7.5 0 0 1-7.5 7.5A9 9 0 0 1 4.5 10.5" />
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v8" />
      <path d="M6.3 7.5a7.5 7.5 0 1 0 11.4 0" />
    </>
  ),
  kernel: (
    <>
      <path d="M12 3 4 7v5c0 4.4 3.4 8.2 8 9 4.6-.8 8-4.6 8-9V7Z" />
      <path d="m9 11 2 2-2 2M13 15h2" />
    </>
  ),
  slope: (
    <>
      <path d="M3 5c3 0 4 14 9 14s6-7 9-7" />
      <circle cx="12" cy="19" r="1.6" />
    </>
  ),
  graph: (
    <>
      <circle cx="5" cy="7" r="2" />
      <circle cx="5" cy="17" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
      <path d="m6.8 8 3.4 3M6.8 16l3.4-3M14 12h3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7Z" />
      <path d="M19 15c.3 1.6 1 2.3 2.5 2.5-1.6.3-2.2 1-2.5 2.5-.3-1.6-1-2.2-2.5-2.5 1.6-.3 2.2-1 2.5-2.5Z" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  feather: (
    <>
      <path d="M20 4c-8 0-13 5-13 13v3" />
      <path d="M7 17c6 0 11-4 13-13M10 13h5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.8" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.7 2.7L16 9.5" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7Z" />,
  mountain: (
    <>
      <path d="m2 20 7-12 4 6 2-3 7 9Z" />
      <path d="M9 8V3l4 2-4 2" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" />
    </>
  ),
  pack: (
    <>
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9Z" />
      <path d="m3 7.5 9 4.5 9-4.5M12 12v9" />
    </>
  ),
  disk: (
    <>
      <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
      <path d="M8 3v5h7V3M8 21v-6h8v6" />
    </>
  ),
  bug: (
    <>
      <rect x="8" y="7" width="8" height="12" rx="4" />
      <path d="M12 11v8M8 12H4M20 12h-4M8 16H5M19 16h-3M9 7 7 4M15 7l2-3" />
    </>
  ),
  stack: (
    <>
      <path d="m12 3 9 4.5-9 4.5-9-4.5Z" />
      <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
    </>
  ),
  crown: (
    <>
      <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 10H5Z" />
      <path d="M5 21h14" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  run: (
    <>
      <circle cx="14" cy="4.5" r="1.8" />
      <path d="m6 21 3.5-6 3 2.5V22M8 11l3-3.5 4 1.5 2 3.5h3M11 7.5 9.5 15" />
    </>
  ),
  loop: (
    <>
      <path d="M4 12a8 8 0 0 1 14-5.3L20 9" />
      <path d="M20 4v5h-5" />
      <path d="M20 12a8 8 0 0 1-14 5.3L4 15" />
      <path d="M4 20v-5h5" />
    </>
  ),
  smoke: (
    <>
      <path d="M8 21c-2 0-3-1.5-3-3s1-2.5 2.5-2.5c0-2 1.5-3 3-3 1 0 2 .5 2.5 1.5 1.5-.5 3 .5 3 2 1.5 0 2.5 1 2.5 2.5S17.5 21 16 21Z" />
      <path d="M10 9c-1-1.5 1-2.5 0-4M14 9c-1-1.5 1-2.5 0-4" />
    </>
  ),
};

export function AchievementIcon({ name, size = 22 }: { name: IconName; size?: number }) {
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
    >
      {PATHS[name]}
    </svg>
  );
}

/** Trophy, for menus and the level map chip. */
export function TrophyIcon({ size = 16 }: { size?: number }) {
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
    >
      <path d="M8 4h8v5a4 4 0 0 1-8 0Z" />
      <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4" />
    </svg>
  );
}

/** Padlock for locked cards. */
export function SmallLockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
