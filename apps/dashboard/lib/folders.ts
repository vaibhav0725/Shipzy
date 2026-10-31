import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { InputError } from './validate';

export interface FolderEntry {
  name: string;
  path: string;
  /** has a package.json, so it may be a project */
  isProject: boolean;
}

export interface FolderListing {
  path: string;
  parent: string | null;
  entries: FolderEntry[];
  /** what the folder itself looks like, when it has a package.json */
  project?: { name: string; suggestedProject: string; framework: string; supported: boolean; hasBuildScript: boolean };
}

const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);

function readPackage(dir: string): { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

const sanitize = (s: string) => s.toLowerCase().replace(/^@[^/]+\//, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

/** Does next.config ask for a static export? (A hint; the CLI repeats the check, and more, when you deploy.) */
function hasStaticExport(dir: string): boolean {
  for (const name of ['next.config.mjs', 'next.config.js', 'next.config.ts', 'next.config.cjs', 'next.config.mts']) {
    try {
      const text = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
      return /\boutput\s*:\s*(['"`])export\1/.test(text);
    } catch {
      /* try the next file name */
    }
  }
  return false;
}

/** A hint only; the CLI does the real detection (and refusal) when you deploy. */
function describe(dir: string): FolderListing['project'] {
  const pkg = readPackage(dir);
  if (!pkg) return undefined;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const nextStatic = Boolean(deps.next) && hasStaticExport(dir);
  const framework = deps.next
    ? nextStatic
      ? 'Next.js (static export)'
      : "Next.js without output: 'export'"
    : deps.vite
      ? 'Vite'
      : deps['react-scripts']
        ? 'Create React App'
        : deps.react
          ? 'React (unknown tooling)'
          : 'not a React project';
  return {
    name: pkg.name ?? path.basename(dir),
    suggestedProject: sanitize(pkg.name ?? path.basename(dir)) || 'my-app',
    framework,
    supported: deps.next ? nextStatic : Boolean(deps.react) && Boolean(deps.vite || deps['react-scripts']),
    hasBuildScript: Boolean(pkg.scripts?.build),
  };
}

export function listFolder(requested: string | undefined, fallback: string): FolderListing {
  const target = path.resolve(requested && requested !== '' ? requested : fallback || os.homedir());
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new InputError(`"${target}" does not exist.`);
  }
  if (!stat.isDirectory()) throw new InputError(`"${target}" is not a folder.`);

  const entries: FolderEntry[] = [];
  try {
    for (const e of fs.readdirSync(target, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const full = path.join(target, e.name);
      entries.push({ name: e.name, path: full, isProject: fs.existsSync(path.join(full, 'package.json')) });
    }
  } catch {
    throw new InputError(`"${target}" cannot be read.`);
  }
  entries.sort((a, b) => Number(b.isProject) - Number(a.isProject) || a.name.localeCompare(b.name));

  const parent = path.dirname(target);
  return { path: target, parent: parent === target ? null : parent, entries, project: describe(target) };
}
