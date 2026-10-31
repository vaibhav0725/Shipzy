'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchEntry } from '@/lib/search';
import type { DocMeta } from '@/lib/docs';
import { Icon } from './Icons';

const SECTIONS = ['Start', 'Guides', 'Dashboard', 'Reference'];

/** A search box over every docs page and heading. "/" focuses it from anywhere. */
function DocsSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<SearchEntry[]>();
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement | null)?.tagName ?? '');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const load = () => {
    if (index) return;
    fetch('/search-index.json')
      .then((r) => r.json())
      .then((data: SearchEntry[]) => setIndex(data))
      .catch(() => setIndex([]));
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !index) return [];
    const words = q.split(/\s+/);
    return index
      .filter((e) => {
        const hay = `${e.title} ${e.heading ?? ''} ${e.text}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => Number(Boolean(a.heading)) - Number(Boolean(b.heading)))
      .slice(0, 8);
  }, [index, query]);

  const go = (e?: SearchEntry) => {
    if (!e) return;
    setOpen(false);
    setQuery('');
    input.current?.blur();
    router.push(e.href);
  };

  return (
    <div className="dsearch">
      <Icon name="search" />
      <input
        ref={input}
        type="text"
        value={query}
        placeholder="Search docs"
        aria-label="Search the documentation"
        spellCheck={false}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
          if (e.key === 'Enter') go(results[active]);
          if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }}
      />
      <kbd>/</kbd>
      {open && query.trim() !== '' && (
        <div className="results" role="listbox">
          {results.length === 0 ? (
            <div className="none">{index ? `Nothing matches "${query}".` : 'Loading…'}</div>
          ) : (
            results.map((r, i) => (
              <Link key={r.href} href={r.href} className={i === active ? 'on' : undefined} onMouseEnter={() => setActive(i)} onClick={() => { setOpen(false); setQuery(''); }}>
                {r.heading ?? r.title}
                <small>{r.heading ? `${r.section} › ${r.title}` : r.section}</small>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ docs }: { docs: DocMeta[] }) {
  const path = usePathname();
  return (
    <nav className="sidebar" aria-label="Documentation">
      <DocsSearch />
      {SECTIONS.map((section) => (
        <div className="group" key={section}>
          <span className="label faint">{section}</span>
          {docs.filter((d) => d.section === section).map((d) => (
            <Link key={d.slug} href={`/docs/${d.slug}`} aria-current={path === `/docs/${d.slug}` ? 'page' : undefined}>
              {d.title}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function MobileNav({ docs }: { docs: DocMeta[] }) {
  const path = usePathname();
  const router = useRouter();
  return (
    <div className="docs-mobile">
      <label htmlFor="docs-select" style={{ position: 'absolute', left: -9999 }}>Documentation page</label>
      <select id="docs-select" value={path} onChange={(e) => router.push(e.target.value)}>
        {SECTIONS.map((section) => (
          <optgroup key={section} label={section}>
            {docs.filter((d) => d.section === section).map((d) => (
              <option key={d.slug} value={`/docs/${d.slug}`}>{d.title}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/** "On this page": the heading you are reading is highlighted as you scroll. */
export function Toc({ items }: { items: { id: string; text: string; level: 2 | 3 }[] }) {
  const [current, setCurrent] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((t) => document.getElementById(t.id)).filter((e): e is HTMLElement => Boolean(e));
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setCurrent(visible.target.id);
      },
      { rootMargin: '-80px 0px -65% 0px' },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);
  return (
    <aside className="toc" aria-label="On this page">
      <span className="label faint">On this page</span>
      {items.map((t) => (
        <a key={t.id} href={`#${t.id}`} className={`${t.level === 3 ? 'l3' : ''} ${current === t.id ? 'on' : ''}`.trim() || undefined}>
          {t.text}
        </a>
      ))}
    </aside>
  );
}
