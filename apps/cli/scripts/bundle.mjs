// Bundles the CLI and the workspace code it uses into one file, dist/deployer.mjs, so the published package has no
// runtime dependencies and does not depend on the monorepo.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(pkgDir, 'dist/deployer.mjs');
const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));

await build({
  entryPoints: [path.join(pkgDir, 'src/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  define: { __DEPLOYER_VERSION__: JSON.stringify(version) },
  // Some bundled dependencies use require(); give them one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: 'none',
  logLevel: 'warning',
});

// esbuild keeps the entry's `#!` line first; make the file runnable directly.
fs.chmodSync(outfile, 0o755);
const kb = Math.round(fs.statSync(outfile).size / 1024);
console.log(`Wrote ${path.relative(path.resolve(pkgDir, '../..'), outfile)} (${kb} KB, v${version})`);
