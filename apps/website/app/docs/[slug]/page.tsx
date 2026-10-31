import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Toc } from '@/components/DocsNav';
import { allDocs, getDoc } from '@/lib/docs';
import { site } from '@/lib/site';

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

  const editUrl = site.repoUrl ? `${site.repoUrl}/edit/main/apps/website/content/docs/${doc.slug}.md` : undefined;

  return (
    <div className="doc-grid">
      <article style={{ minWidth: 0 }}>
        <span className="label">{doc.section}</span>
        <h1 className="doc-title">{doc.title}</h1>
        <p className="doc-desc">{doc.description}</p>
        <div className="doc-meta">
          <span>~{doc.minutes} min read</span>
          {editUrl && (
            <>
              <span>·</span>
              <a href={editUrl}>Edit on GitHub</a>
            </>
          )}
        </div>
        <div className="prose" style={{ marginTop: '1.75rem' }} dangerouslySetInnerHTML={{ __html: doc.html }} />
        <div className="pager">
          {prev ? <Link href={`/docs/${prev.slug}`}><small>← Previous</small>{prev.title}</Link> : <span />}
          {next && <Link className="next" href={`/docs/${next.slug}`}><small>Next →</small>{next.title}</Link>}
        </div>
      </article>
      <Toc items={doc.toc} />
    </div>
  );
}
