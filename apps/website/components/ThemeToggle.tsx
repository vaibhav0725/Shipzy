'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icons';

type Theme = 'system' | 'light' | 'dark';
const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const icon = { system: 'monitor', light: 'sun', dark: 'moon' } as const;
const KEY = 'shipzy-site-theme';

/** Cycles system, light and dark. The choice is remembered in this browser only. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      /* private mode: stay on system */
    }
  }, []);
  const choose = () => {
    const to = next[theme];
    setTheme(to);
    try {
      localStorage.setItem(KEY, to);
    } catch {
      /* not remembered */
    }
    if (to === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = to;
  };
  return (
    <button type="button" className="icon-btn" onClick={choose} aria-label={`Theme: ${theme}. Click to change.`} title={`Theme: ${theme}`}>
      <Icon name={icon[theme]} />
    </button>
  );
}
