'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { site } from '@/lib/site';
import { Icon, Logo } from './Icons';
import ThemeToggle from './ThemeToggle';

const links = [
  { href: '/docs/getting-started', label: 'Docs', match: '/docs' },
  { href: '/how-it-works', label: 'How it works', match: '/how-it-works' },
  { href: '/security', label: 'Security', match: '/security' },
  { href: '/cost', label: 'Cost', match: '/cost' },
];

export default function Header() {
  const path = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  return (
    <header className="header">
      <div className="container">
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <Logo />
          {site.name}
        </Link>
        <nav className={`nav ${open ? 'open' : ''}`} aria-label="Main">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={path.startsWith(l.match) ? 'page' : undefined} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
        </nav>
        <span className="spacer" />
        <div className="header-actions">
          {site.repoUrl && (
            <a className="icon-btn" href={site.repoUrl} aria-label="GitHub repository" target="_blank" rel="noreferrer">
              <Icon name="github" />
            </a>
          )}
          <ThemeToggle />
          <Link className="btn primary small hide-sm" href="/docs/getting-started">
            Get started
          </Link>
          <button type="button" className="icon-btn menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name={open ? 'x' : 'menu'} />
          </button>
        </div>
      </div>
    </header>
  );
}
