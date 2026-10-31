'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icons';
import { ProjectSummary, useApi } from '@/lib/client';

// Where the documentation lives. The dashboard itself is local; this is only a link.
const DOCS_URL = 'https://shipzy.quantav.xyz/docs/getting-started';

/** "shipzy / projects / my-app" for the page you are on. */
function crumbsFor(path: string): { label: string; href?: string }[] {
  const root = { label: 'shipzy', href: '/' };
  if (path === '/') return [root, { label: 'overview' }];
  if (path === '/projects') return [root, { label: 'projects' }];
  if (path === '/projects/new') return [root, { label: 'projects', href: '/projects' }, { label: 'new' }];
  if (path.startsWith('/projects/')) return [root, { label: 'projects', href: '/projects' }, { label: decodeURIComponent(path.split('/')[2] ?? '') }];
  if (path === '/activity') return [root, { label: 'activity' }];
  if (path.startsWith('/jobs/')) return [root, { label: 'activity', href: '/activity' }, { label: `job ${path.split('/')[2] ?? ''}` }];
  return [root];
}

interface Entry { label: string; hint: string; href: string }

/** Command palette: jump to a page or a project. Opens with Cmd/Ctrl+K or "/". */
function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const projects = useApi<ProjectSummary[]>('/api/projects');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const entries = useMemo<Entry[]>(() => {
    const pages: Entry[] = [
      { label: 'Overview', hint: 'page', href: '/' },
      { label: 'Projects', hint: 'page', href: '/projects' },
      { label: 'New deployment', hint: 'page', href: '/projects/new' },
      { label: 'Activity', hint: 'page', href: '/activity' },
    ];
    const found: Entry[] = (projects.data ?? []).map((p) => ({ label: p.name, hint: p.live[0]?.host ?? 'project', href: `/projects/${p.name}` }));
    const q = query.trim().toLowerCase();
    return [...pages, ...found].filter((e) => !q || e.label.toLowerCase().includes(q) || e.hint.toLowerCase().includes(q)).slice(0, 12);
  }, [projects.data, query]);

  const go = (e?: Entry) => {
    if (!e) return;
    onClose();
    router.push(e.href);
  };

  return (
    <div className="palette-back" onClick={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          type="text"
          value={query}
          placeholder="Search projects and pages"
          aria-label="Search projects and pages"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(entries.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            if (e.key === 'Enter') go(entries[index]);
          }}
        />
        {entries.length === 0 ? (
          <div className="none">Nothing matches &quot;{query}&quot;.</div>
        ) : (
          <ul>
            {entries.map((e, i) => (
              <li key={e.href}>
                <button type="button" className={i === index ? 'on' : ''} onMouseEnter={() => setIndex(i)} onClick={() => go(e)}>
                  <Icon name={e.href.startsWith('/projects/') && e.href !== '/projects/new' ? 'layers' : 'search'} />
                  {e.label}
                  <span className="k">{e.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Topbar() {
  const path = usePathname() ?? '/';
  const crumbs = crumbsFor(path);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement | null)?.tagName ?? '');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="topbar">
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={`${c.label}${i}`} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
            {c.href ? <Link href={c.href}>{c.label}</Link> : <span className="here">{c.label}</span>}
            {i < crumbs.length - 1 && <span className="sep">/</span>}
          </span>
        ))}
      </nav>
      <span className="spacer" />
      <button type="button" className="searchbtn" onClick={() => setOpen(true)} aria-label="Search projects and pages">
        <Icon name="search" />
        <span>Search projects and pages</span>
        <span className="kbd">⌘K</span>
      </button>
      <a className="toplink" href={DOCS_URL} target="_blank" rel="noreferrer">Docs</a>
      {open && <Palette onClose={() => setOpen(false)} />}
    </header>
  );
}
