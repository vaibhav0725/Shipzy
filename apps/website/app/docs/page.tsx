import type { Metadata } from 'next';
import Link from 'next/link';
import { allDocs, SECTIONS } from '@/lib/docs';

export const metadata: Metadata = { title: 'Documentation', description: 'Everything about installing, using and securing shipzy.' };

export default function DocsIndex() {
  const docs = allDocs();
  return (
    <div>
      <h1 className="doc-title">Documentation</h1>
      <p className="doc-desc">Everything about installing, using and securing shipzy. New here? Start with <Link href="/docs/getting-started">Getting started</Link>.</p>
      {SECTIONS.map((section) => (
        <section key={section} style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 14 }}>{section}</h2>
          <div className="grid c2">
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
