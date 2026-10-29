import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import ignore from 'ignore';

const MAX_BYTES = 200 * 1024 * 1024;
const ALWAYS_EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build']);

export interface SourceZip {
  zip: Uint8Array;
  files: number;
  /** .env files that exist locally but are deliberately not uploaded */
  skippedEnvFiles: string[];
}

const isEnvFile = (rel: string) => /(^|\/)\.env(\..+)?$/.test(rel);

function isExcluded(rel: string): boolean {
  const segments = rel.split('/');
  return segments.some((s) => ALWAYS_EXCLUDED_DIRS.has(s) || s === '.DS_Store') || isEnvFile(rel);
}

// Exactly the files git would consider part of the project, including nested .gitignore rules.
function listWithGit(dir: string): string[] | undefined {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: dir,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString('utf8').split('\0').filter(Boolean);
  } catch {
    return undefined;
  }
}

// Fallback for folders that are not git repositories: honour the root .gitignore only.
function listByWalking(dir: string): string[] {
  const rootRules = path.join(dir, '.gitignore');
  const ig = ignore();
  if (fs.existsSync(rootRules)) ig.add(fs.readFileSync(rootRules, 'utf8'));

  const walk = (current: string): string[] =>
    fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (ALWAYS_EXCLUDED_DIRS.has(entry.name) || ig.ignores(entry.isDirectory() ? `${rel}/` : rel)) return [];
      return entry.isDirectory() ? walk(full) : [rel];
    });
  return walk(dir);
}

export function zipSource(dir: string): SourceZip {
  const listed = (listWithGit(dir) ?? listByWalking(dir)).map((p) => p.split(path.sep).join('/'));
  const skippedEnvFiles = listed.filter((rel) => isEnvFile(rel) && !rel.split('/').some((s) => ALWAYS_EXCLUDED_DIRS.has(s)));

  const entries: Record<string, [Uint8Array, { mtime: Date; os: number; attrs: number }]> = {};
  let total = 0;
  for (const rel of listed) {
    if (isExcluded(rel)) continue;
    const full = path.join(dir, rel);
    const stat = fs.lstatSync(full, { throwIfNoEntry: false });
    if (!stat?.isFile()) continue; // deleted-but-tracked files, symlinks, submodule directories
    total += stat.size;
    if (total > MAX_BYTES) {
      throw new Error(`Source is larger than ${MAX_BYTES / 1048576} MB after exclusions; check your .gitignore.`);
    }
    entries[rel] = [
      fs.readFileSync(full),
      { mtime: stat.mtime, os: 3, attrs: (((0o100000 | (stat.mode & 0o777)) << 16) >>> 0) },
    ];
  }

  const files = Object.keys(entries).length;
  if (files === 0) throw new Error(`No source files found in ${dir}.`);
  return { zip: zipSync(entries, { level: 6 }), files, skippedEnvFiles };
}
