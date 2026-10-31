'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, IconName, Logo } from '@/components/Icons';
import { Status, useApi } from '@/lib/client';

const links: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Overview', icon: 'home' },
  { href: '/projects', label: 'Projects', icon: 'layers' },
  { href: '/projects/new', label: 'New deployment', icon: 'rocket' },
  { href: '/activity', label: 'Activity', icon: 'activity' },
];

type Theme = 'system' | 'light' | 'dark';

/** System / light / dark. The choice is remembered in this browser only. */
function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('deployer-theme');
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      /* private mode: stay on system */
    }
  }, []);
  const choose = (next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem('deployer-theme', next);
    } catch {
      /* the choice just will not be remembered */
    }
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  };
  const options: { id: Theme; icon: IconName; label: string }[] = [
    { id: 'system', icon: 'monitor', label: 'Match system' },
    { id: 'light', icon: 'sun', label: 'Light' },
    { id: 'dark', icon: 'moon', label: 'Dark' },
  ];
  return (
    <div className="theme" role="group" aria-label="Theme">
      {options.map((o) => (
        <button key={o.id} type="button" className={theme === o.id ? 'on' : ''} title={o.label} aria-label={o.label} aria-pressed={theme === o.id} onClick={() => choose(o.id)}>
          <Icon name={o.icon} />
        </button>
      ))}
    </div>
  );
}

export default function Nav() {
  const path = usePathname();
  const { data } = useApi<Status>('/api/status');
  const active = (href: string) =>
    href === '/' ? path === '/' : href === '/projects' ? path === '/projects' || (path.startsWith('/projects/') && path !== '/projects/new') : path.startsWith(href);
  return (
    <aside className="side">
      <Link href="/" className="brand">
        <Logo />
        shipzy
      </Link>
      <nav className="nav" aria-label="Main">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={active(l.href) ? 'active' : ''} aria-current={active(l.href) ? 'page' : undefined}>
            <Icon name={l.icon} />
            {l.label}
          </Link>
        ))}
      </nav>
      <ThemeSwitch />
      <div className="acct">
        {data ? (
          <>
            <strong>AWS {data.account}</strong>
            <span>
              {data.region} · stack {data.stack.name}
            </span>
          </>
        ) : (
          <span>Local dashboard</span>
        )}
      </div>
    </aside>
  );
}
