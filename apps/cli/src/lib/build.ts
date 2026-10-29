import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BuildResult {
  outDir: string;
  framework: string;
}

const LAST_OUTPUT_CHARS = 4000;

// Streams the command's output as it runs, and keeps the tail of stderr so a failure can be explained.
function run(command: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: ['inherit', 'inherit', 'pipe'] });
    let tail = '';
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      tail = (tail + chunk.toString()).slice(-LAST_OUTPUT_CHARS);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`"${command}" exited with code ${code}.${hintFor(tail)}`));
    });
  });
}

function hintFor(stderrTail: string): string {
  if (stderrTail.includes('ERESOLVE')) {
    return (
      '\n\nnpm could not resolve a peer-dependency conflict in your project (ERESOLVE).' +
      '\nFix the versions in the project, or deploy with a looser install, for example:' +
      '\n  --install-command "npm ci --legacy-peer-deps"'
    );
  }
  return '';
}

function detectPackageManager(dir: string): { cmd: string; install: string } {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return { cmd: 'pnpm', install: 'install --frozen-lockfile' };
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return { cmd: 'yarn', install: 'install --frozen-lockfile' };
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return { cmd: 'npm', install: 'ci' };
  return { cmd: 'npm', install: 'install' };
}

export function detectFramework(dir: string): string {
  const pkg = readPackageJson(dir);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
  if (deps['next']) {
    throw new Error('Next.js is not supported yet: only static React (Vite / Create React App) projects.');
  }
  if (deps['vite']) return 'vite';
  if (deps['react-scripts']) return 'create-react-app';
  if (!deps['react']) throw new Error('This does not look like a React project (no "react" dependency).');
  return 'react';
}

export function readPackageJson(dir: string): {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) throw new Error(`No package.json found in ${dir}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function findOutputDir(dir: string): string {
  for (const candidate of ['dist', 'build']) {
    const out = path.join(dir, candidate);
    if (fs.existsSync(path.join(out, 'index.html'))) return out;
  }
  throw new Error('Build output not found: expected dist/index.html or build/index.html.');
}

export interface BuildOptions {
  skipBuild: boolean;
  /** replaces the detected install step, e.g. "npm ci --legacy-peer-deps" */
  installCommand?: string;
  /** replaces the detected build step */
  buildCommand?: string;
}

export async function build(dir: string, opts: BuildOptions): Promise<BuildResult> {
  const framework = detectFramework(dir);
  if (!opts.skipBuild) {
    const pm = detectPackageManager(dir);
    await run(opts.installCommand ?? `${pm.cmd} ${pm.install}`, dir);
    if (opts.buildCommand === undefined && !readPackageJson(dir).scripts?.['build']) {
      throw new Error('package.json has no "build" script (or pass --build-command).');
    }
    await run(opts.buildCommand ?? `${pm.cmd} run build`, dir);
  }
  return { outDir: findOutputDir(dir), framework };
}
