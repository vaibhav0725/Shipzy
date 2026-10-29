import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The package keeps its assets in <package>/assets. The code runs from dist/ (the single-file bundle) or
// dist/<folder>/ (a plain tsc build), so look in both places.
export function assetPath(name: string): string {
  for (const rel of [`../assets/${name}`, `../../assets/${name}`, `../../../assets/${name}`]) {
    const file = fileURLToPath(new URL(rel, import.meta.url));
    if (fs.existsSync(file)) return file;
  }
  return fileURLToPath(new URL(`../assets/${name}`, import.meta.url));
}
