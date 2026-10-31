import type { ReactNode } from 'react';

// Small stroke icons on a 24px grid, drawn inline so the site needs no icon package.
const paths: Record<string, ReactNode> = {
  rocket: <><path d="M5 15c-1.5 1.3-2 4-2 4s2.7-.5 4-2" /><path d="M9 12.5 6 12l-2 2 4 1M11.5 15l.5 3 2-2-1-4" /><path d="M14 4.5c3-1.7 6-1.5 6-1.5s.2 3-1.5 6l-7 7-3.5-3.5 6-8Z" /><circle cx="15.5" cy="8.5" r="1.2" /></>,
  github: <><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></>,
  branch: <><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10M18 10c0 4-6 3-12 7" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-4" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M16 7l3 3M14 9l2 2" /></>,
  shield: <><path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  eyeoff: <><path d="M3 3l18 18" /><path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6-.5 1-1.600 2.500-3.200 3.800M6.700 6.800C4.700 8.100 3.300 10.100 2.500 12c1 2 4.500 6 9.500 6 1.400 0 2.700-.3 3.800-.8" /><path d="M9.900 10a3 3 0 0 0 4.100 4.100" /></>,
  terminal: <><path d="m5 8 4 4-4 4" /><path d="M12 17h7" /></>,
  layout: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 20V9" /></>,
  zap: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  coins: <><circle cx="9" cy="9" r="6" /><path d="M15.500 9.500A6 6 0 1 1 9.500 15.500" /><path d="M9 7v4M7.500 9h3" /></>,
  cloud: <path d="M7 18a4.500 4.500 0 0 1-.6-8.960A6 6 0 0 1 18 9.500a4 4 0 0 1-1 8.500H7Z" />,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></>,
  check: <path d="m5 12.500 4.500 4.500L19 7.500" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400" /></>,
  moon: <path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500Z" />,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></>,
  server: <><rect x="3" y="4" width="18" height="6" rx="1.500" /><rect x="3" y="14" width="18" height="6" rx="1.500" /><path d="M7 7h.01M7 17h.01" /></>,
  pr: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 8v8M18 16V9a3 3 0 0 0-3-3h-2m0 0 2-2m-2 2 2 2" /></>,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/** The shipzy mark: an outlined square with an ember square on top. The outline follows the theme (ink on paper, paper on ink). */
export function Logo() {
  return (
    <svg className="mark" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="6.25" y="35.75" width="58.5" height="58" fill="none" stroke="var(--text)" strokeWidth="12.5" />
      <rect x="33" y="0" width="66.5" height="66.5" fill="#E8693A" />
    </svg>
  );
}
