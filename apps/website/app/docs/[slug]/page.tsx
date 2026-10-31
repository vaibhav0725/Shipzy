import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { allDocs, getDoc } from '@/lib/docs';

export const dynamicParams = false;

export function generateStaticParams() {
  return allDocs().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = allDocs().find((d) => d.slug === slug);
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const docs = allDocs();
  const index = docs.findIndex((d) => d.slug === slug);
  if (index < 0) notFound();
  const doc = getDoc(slug);
  const prev = docs[index - 1];
  const next = docs[index + 1];

  return (
    <div className="doc-grid">
      <article>
        <p className="faint" style={{ fontSize: 13.5, fontWeight: 650, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 10 }}>{doc.section}</p>
        <h1 className="doc-title">{doc.title}</h1>
        <p className="doc-desc">{doc.description}</p>
        <div className="prose" style={{ marginTop: 28 }} dangerouslySetInnerHTML={{ __html: doc.html }} />
        <div className="pager">
          {prev ? <Link href={`/docs/${prev.slug}`}><small>Previous</small>{prev.title}</Link> : <span />}
          {next && <Link className="next" href={`/docs/${next.slug}`}><small>Next</small>{next.title}</Link>}
        </div>
      </article>
      <aside className="toc" aria-label="On this page">
        <h4>On this page</h4>
        {doc.toc.map((t) => (
          <a key={t.id} href={`#${t.id}`} className={t.level === 3 ? 'l3' : undefined}>{t.text}</a>
        ))}
      </aside>
    </div>
  );
}
