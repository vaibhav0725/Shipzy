'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Status, useApi } from '@/lib/client';

const links = [
  { href: '/', label: 'Overview' },
  { href: '/projects', label: 'Projects' },
  { href: '/projects/new', label: 'New deployment' },
  { href: '/activity', label: 'Activity' },
];

export default function Nav() {
  const path = usePathname();
  const { data } = useApi<Status>('/api/status');
  const active = (href: string) => (href === '/' ? path === '/' : href === '/projects' ? path === '/projects' || (path.startsWith('/projects/') && path !== '/projects/new') : path.startsWith(href));
  return (
    <aside className="side">
      <div className="brand">deployer</div>
      <nav className="nav">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={active(l.href) ? 'active' : ''}>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="foot">
        {data ? (
          <>
            Account {data.account}
            <br />
            {data.region} · stack {data.stack.name}
          </>
        ) : (
          'Local dashboard'
        )}
      </div>
    </aside>
  );
}
