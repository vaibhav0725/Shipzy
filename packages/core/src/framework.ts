import * as fs from 'node:fs';
import * as path from 'node:path';

// What kind of project is this, where does its build output land, and how must the edge serve it?
// One implementation for both places that need the answer: `shipzy deploy` on a machine, and the build script that
// runs in CodeBuild (which gets a bundled copy of this file; see packages/engine/scripts/build.mjs).

export type Framework = 'vite' | 'create-react-app' | 'react' | 'next-static';

/**
 * How the edge router maps a request path to a file:
 * - absent ("spa"): a single-page app: every path without a file extension is served `/index.html`.
 * - "html": a multi-page static site with one `<route>.html` per route (Next.js `output: 'export'`).
 * - "dir": a multi-page static site with one `<route>/index.html` per route (`trailingSlash: true`).
 */
export type Routing = 'html' | 'dir';

export interface ProjectKind {
  framework: Framework;
  /** human-readable, for messages */
  label: string;
  /** folders (relative to the project) the build may write its output to, in order of preference */
  outputDirs: string[];
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function readPackageJson(dir: string): PackageJson {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) throw new Error(`No package.json found in ${dir}`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJson;
}

const NEXT_CONFIGS = ['next.config.mjs', 'next.config.js', 'next.config.ts', 'next.config.cjs', 'next.config.mts'];

const NEXT_HELP =
  'Only a static export of Next.js can be deployed (no server runs on this platform). In next.config add:\n' +
  "  output: 'export',\n  images: { unoptimized: true },\n" +
  'and remove anything that needs a server (API routes, middleware, getServerSideProps, revalidation).';

/** Removes comments so a commented-out `output: 'export'` does not count. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

const exists = (dir: string, ...parts: string[]) => fs.existsSync(path.join(dir, ...parts));

function checkNextStatic(dir: string): void {
  const configFile = NEXT_CONFIGS.find((f) => exists(dir, f));
  const config = configFile ? stripComments(fs.readFileSync(path.join(dir, configFile), 'utf8')) : '';
  if (!/\boutput\s*:\s*(['"`])export\1/.test(config)) {
    throw new Error(
      `This is a Next.js project that is not set up for a static export${configFile ? ` (${configFile} has no output: 'export')` : ' (no next.config file)'}.\n${NEXT_HELP}`,
    );
  }

  // Things a static export silently drops or cannot do. Refuse rather than deploy a site that behaves differently.
  const problems: string[] = [];
  for (const root of ['', 'src']) {
    for (const name of ['middleware', 'proxy']) {
      for (const ext of ['ts', 'js', 'mts', 'mjs']) {
        if (exists(dir, root, `${name}.${ext}`)) problems.push(`${path.join(root, `${name}.${ext}`)} (middleware does not run on a static site)`);
      }
    }
    if (exists(dir, root, 'pages', 'api')) problems.push(`${path.join(root, 'pages', 'api')} (API routes need a server)`);
  }
  if (problems.length > 0) {
    throw new Error(`This Next.js project uses features a static site cannot provide:\n  ${problems.join('\n  ')}\n${NEXT_HELP}`);
  }
}

export function detectProject(dir: string): ProjectKind {
  const pkg = readPackageJson(dir);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['next']) {
    checkNextStatic(dir);
    return { framework: 'next-static', label: 'Next.js (static export)', outputDirs: ['out'] };
  }
  if (deps['vite']) return { framework: 'vite', label: 'Vite', outputDirs: ['dist', 'build'] };
  if (deps['react-scripts']) return { framework: 'create-react-app', label: 'Create React App', outputDirs: ['build', 'dist'] };
  if (!deps['react']) throw new Error('This does not look like a React project (no "react" dependency).');
  return { framework: 'react', label: 'React', outputDirs: ['dist', 'build'] };
}

/** The first output folder that exists and holds an index.html. */
export function findOutputDir(dir: string, kind: ProjectKind): string {
  for (const candidate of kind.outputDirs) {
    const out = path.join(dir, candidate);
    if (fs.existsSync(path.join(out, 'index.html'))) return out;
  }
  const expected = kind.outputDirs.map((d) => `${d}/index.html`).join(' or ');
  throw new Error(
    kind.framework === 'next-static'
      ? `Build output not found: expected ${expected}. Is output: 'export' set in next.config?`
      : `Build output not found: expected ${expected}.`,
  );
}

/**
 * How the edge must route a finished build. A single-page app needs nothing special (undefined). A static
 * multi-page export is served either from `<route>.html` or, with trailingSlash, from `<route>/index.html`.
 */
export function detectRouting(outDir: string, kind: ProjectKind): Routing | undefined {
  if (kind.framework !== 'next-static') return undefined;
  const folderIndexes = fs
    .readdirSync(outDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_next' && fs.existsSync(path.join(outDir, e.name, 'index.html')));
  return folderIndexes.length > 0 ? 'dir' : 'html';
}

/** Extra explanation for a failed build, when the failure is a known static-export problem. */
export function hintForBuildFailure(output: string): string {
  if (output.includes('ERESOLVE')) {
    return (
      '\n\nnpm could not resolve a peer-dependency conflict in your project (ERESOLVE).' +
      '\nFix the versions in the project, or deploy with a looser install, for example:' +
      '\n  --install-command "npm ci --legacy-peer-deps"'
    );
  }
  if (/Image Optimization using the default loader is not compatible with/i.test(output)) {
    return "\n\nNext.js cannot resize images on a static site. In next.config add:\n  images: { unoptimized: true }";
  }
  if (/output:\s*['"]?export['"]?|Page .* is missing .generateStaticParams|getServerSideProps|API Routes/i.test(output)) {
    return `\n\nThis project uses something a static export cannot do.\n${NEXT_HELP}`;
  }
  return '';
}
