import { allDocs, getDoc } from './docs';

export interface SearchEntry {
  title: string;
  section: string;
  href: string;
  /** a heading inside the page, when the entry points at one */
  heading?: string;
  text: string;
}

/** Every page and every heading of the docs, for the search box. Built at deploy time; nothing runs on a server. */
export function buildIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const meta of allDocs()) {
    const doc = getDoc(meta.slug);
    entries.push({ title: doc.title, section: doc.section, href: `/docs/${doc.slug}`, text: doc.description });
    for (const h of doc.toc) entries.push({ title: doc.title, section: doc.section, href: `/docs/${doc.slug}#${h.id}`, heading: h.text, text: '' });
  }
  return entries;
}
