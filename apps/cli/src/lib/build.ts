import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectProject, detectRouting, findOutputDir, hintForBuildFailure, readPackageJson, type Framework, type Routing } from '@shipzy/core';

export interface BuildResult {
  outDir: string;
  /** human-readable, e.g. "Vite" or "Next.js (static export)" */
  framework: string;
  frameworkId: Framework;
  /** how the edge must serve a multi-page static site; undefined for a single-page app */
  routing?: Routing;
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
      reject(new Error(`"${command}" exited with code ${code}.${hintForBuildFailure(tail)}`));
    });
  });
}

function detectPackageManager(dir: string): { cmd: string; install: string } {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return { cmd: 'pnpm', install: 'install --frozen-lockfile' };
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return { cmd: 'yarn', install: 'install --frozen-lockfile' };
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return { cmd: 'npm', install: 'ci' };
  return { cmd: 'npm', install: 'install' };
}

/** The project's kind, or a clear reason it cannot be deployed. Cheap: use it to fail before anything is built or queued. */
export function detectFramework(dir: string): string {
  return detectProject(dir).label;
}

export interface BuildOptions {
  skipBuild: boolean;
  /** replaces the detected install step, e.g. "npm ci --legacy-peer-deps" */
  installCommand?: string;
  /** replaces the detected build step */
  buildCommand?: string;
}

export async function build(dir: string, opts: BuildOptions): Promise<BuildResult> {
  const kind = detectProject(dir);
  if (!opts.skipBuild) {
    const pm = detectPackageManager(dir);
    await run(opts.installCommand ?? `${pm.cmd} ${pm.install}`, dir);
    if (opts.buildCommand === undefined && !readPackageJson(dir).scripts?.['build']) {
      throw new Error('package.json has no "build" script (or pass --build-command).');
    }
    await run(opts.buildCommand ?? `${pm.cmd} run build`, dir);
  }
  const outDir = findOutputDir(dir, kind);
  return { outDir, framework: kind.label, frameworkId: kind.framework, routing: detectRouting(outDir, kind) };
}
