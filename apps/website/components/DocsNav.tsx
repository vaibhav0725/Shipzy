'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { DocMeta } from '@/lib/docs';

const SECTIONS = ['Start', 'Guides', 'Dashboard', 'Reference'];

export function Sidebar({ docs }: { docs: DocMeta[] }) {
  const path = usePathname();
  return (
    <nav className="sidebar" aria-label="Documentation">
      {SECTIONS.map((section) => (
        <div key={section}>
          <h4>{section}</h4>
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
      <label className="sr-only" htmlFor="docs-select" style={{ position: 'absolute', left: -9999 }}>Documentation page</label>
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
