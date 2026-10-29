// Bundles the Lambda handlers into apps/cli/assets/engine.zip. The zip is deterministic so `deployer init` can key it by content hash.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { zipSync } from 'fflate';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pkgDir, '../..');
const outZip = path.join(repoRoot, 'apps/cli/assets/engine.zip');
const dist = path.join(pkgDir, 'dist');

await build({
  entryPoints: [path.join(pkgDir, 'src/index.ts')],
  outfile: path.join(dist, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  legalComments: 'none',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});

const mtime = new Date(Date.UTC(2020, 0, 1));
const entries = { 'index.mjs': fs.readFileSync(path.join(dist, 'index.mjs')) };
const zipped = zipSync(
  Object.fromEntries(
    Object.entries(entries).map(([name, data]) => [
      name,
      [data, { mtime, os: 3, attrs: (0o100644 << 16) >>> 0 }],
    ]),
  ),
  { level: 6 },
);

fs.mkdirSync(path.dirname(outZip), { recursive: true });
fs.writeFileSync(outZip, zipped);
const hash = createHash('sha256').update(zipped).digest('hex').slice(0, 16);
console.log(`Wrote ${path.relative(repoRoot, outZip)} (${(zipped.length / 1048576).toFixed(1)} MB, sha256 ${hash})`);
