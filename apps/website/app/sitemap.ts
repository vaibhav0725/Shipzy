import type { MetadataRoute } from 'next';
import { allDocs } from '@/lib/docs';
import { site } from '@/lib/site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['', '/how-it-works', '/security', '/cost', '/docs', ...allDocs().map((d) => `/docs/${d.slug}`)];
  return pages.map((path) => ({ url: `${site.url}${path}`, lastModified: new Date() }));
}
