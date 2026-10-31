import fs from 'node:fs';
import path from 'node:path';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import yaml from 'highlight.js/lib/languages/yaml';
import plaintext from 'highlight.js/lib/languages/plaintext';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('plaintext', plaintext);

export const SECTIONS = ['Start', 'Guides', 'Dashboard', 'Reference'] as const;

export interface DocMeta {
  slug: string;
  title: string;
  description: string;
  section: (typeof SECTIONS)[number];
  order: number;
}
export interface TocItem { id: string; text: string; level: 2 | 3 }
export interface Doc extends DocMeta { html: string; toc: TocItem[] }

const DIR = path.join(process.cwd(), 'content', 'docs');

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      return hljs.highlight(code, { language: hljs.getLanguage(lang) ? lang : 'plaintext' }).value;
    },
  }),
);

function parseFile(file: string): { meta: DocMeta; body: string } {
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!match) throw new Error(`${file} has no front matter`);
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const section = fields.section as DocMeta['section'];
  if (!SECTIONS.includes(section)) throw new Error(`${file}: unknown section "${fields.section}"`);
  return {
    meta: { slug: file.replace(/\.md$/, ''), title: fields.title ?? file, description: fields.description ?? '', section, order: Number(fields.order ?? 99) },
    body: raw.slice(match[0].length),
  };
}

export function allDocs(): DocMeta[] {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseFile(f).meta)
    .sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.order - b.order);
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function getDoc(slug: string): Doc {
  const { meta, body } = parseFile(`${slug}.md`);
  let html = marked.parse(body, { async: false }) as string;

  // Headings get an id and a link to themselves; they also feed the table of contents.
  const toc: TocItem[] = [];
  const seen = new Map<string, number>();
  html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_all, level: string, inner: string) => {
    const text = stripTags(inner);
    const base = slugify(text) || 'section';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const id = n === 0 ? base : `${base}-${n}`;
    toc.push({ id, text, level: Number(level) as 2 | 3 });
    return `<h${level} id="${id}">${inner}<a class="heading-anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>`;
  });

  // Code blocks get a copy button; tables scroll sideways instead of widening the page.
  html = html.replace(/<pre>([\s\S]*?)<\/pre>/g, '<div class="code"><button class="copy" type="button">Copy</button><pre>$1</pre></div>');
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');

  // ![caption](shot:overview) becomes a screenshot with a light and a dark version.
  html = html.replace(/<p><img src="shot:([a-z0-9-]+)" alt="([^"]*)"[^>]*><\/p>/g, (_m, name: string, alt: string) =>
    `<figure class="shot"><a class="light" href="/shots/${name}-light.png" target="_blank" rel="noopener"><img src="/shots/${name}-light.png" alt="${alt}" width="1360" height="860" loading="lazy"></a><a class="dark" href="/shots/${name}-dark.png" target="_blank" rel="noopener"><img src="/shots/${name}-dark.png" alt="${alt}" width="1360" height="860" loading="lazy"></a><figcaption>${alt} <span style="opacity:.7">(click to enlarge)</span></figcaption></figure>`,
  );

  return { ...meta, html, toc };
}
