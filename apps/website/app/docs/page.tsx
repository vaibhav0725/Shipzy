import type { Metadata } from 'next';
import Link from 'next/link';
import { allDocs, SECTIONS } from '@/lib/docs';

export const metadata: Metadata = { title: 'Documentation', description: 'Everything about installing, using and securing shipzy.' };

export default function DocsIndex() {
  const docs = allDocs();
  return (
    <div>
      <span className="label">Docs</span>
      <h1 className="doc-title">Documentation</h1>
      <p className="doc-desc">Everything about installing, using and securing shipzy. New here? Start with <Link href="/docs/getting-started">Getting started</Link>.</p>
      {SECTIONS.map((section) => (
        <section key={section} style={{ marginTop: 40 }}>
          <span className="label" style={{ display: 'block', marginBottom: '0.75rem' }}>{section}</span>
          <div className="grid2">
            {docs.filter((d) => d.section === section).map((d) => (
              <Link className="card" key={d.slug} href={`/docs/${d.slug}`}>
                <h3 style={{ marginTop: 0 }}>{d.title}</h3>
                <p>{d.description}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
