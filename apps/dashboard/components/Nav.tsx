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
      const saved = localStorage.getItem('shipzy-theme');
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      /* private mode: stay on system */
    }
  }, []);
  const choose = (next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem('shipzy-theme', next);
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
  const projects = useApi<unknown[]>('/api/projects', { interval: 30000 });
  const active = (href: string) =>
    href === '/' ? path === '/' : href === '/projects' ? path === '/projects' || (path.startsWith('/projects/') && path !== '/projects/new') : path.startsWith(href);
  return (
    <aside className="side">
      <Link href="/" className="brand">
        <Logo />
        <span className="name">shipzy</span>
        <span className="tag">local</span>
      </Link>
      <div className="acct">
        <div className="top">
          <span className="label">AWS account</span>
          {data?.demo && <span className="tagline">demo data</span>}
        </div>
        <span className="num">{data ? data.account : '…'}</span>
        <span className="sub">{data ? `${data.region ?? '-'} · ${data.stack.name}` : 'connecting'}</span>
      </div>
      <nav className="nav" aria-label="Main">
        <span className="label">Workspace</span>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={active(l.href) ? 'active' : ''} aria-current={active(l.href) ? 'page' : undefined}>
            <Icon name={l.icon} />
            {l.label}
            {l.href === '/projects' && projects.data && <span className="count">{projects.data.length}</span>}
          </Link>
        ))}
      </nav>
      <div className="foot">
        {data && (
          <div className="stackline">
            <i />
            stack · {data.stack.status.toLowerCase().replace(/_/g, ' ')}
          </div>
        )}
        <ThemeSwitch />
      </div>
    </aside>
  );
}
