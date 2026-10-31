import * as path from 'node:path';
import { assertProjectName, readPackageJson } from '@shipzy/core';

const sanitize = (s: string) =>
  s.toLowerCase().replace(/^@[^/]+\//, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

/** The explicit --project, else a name derived from package.json (or the folder). */
export function resolveProject(dir: string, explicit?: string): string {
  const project = explicit ?? sanitize(readPackageJson(dir).name ?? path.basename(dir));
  assertProjectName(project);
  return project;
}

export function parseKeep(raw: string | undefined, fallback: number): number {
  const keep = Number(raw ?? fallback);
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be a whole number >= 1.');
  return keep;
}
