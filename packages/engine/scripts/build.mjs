// Bundles the Lambda handlers and packs them, with the one native dependency, into
// apps/cli/assets/engine.zip. The zip is deterministic so `deployer init` can key it by content hash.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { zipSync } from 'fflate';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pkgDir, '../..');
const outZip = path.join(repoRoot, 'apps/cli/assets/engine.zip');
const stage = path.join(pkgDir, '.stage');
const dist = path.join(pkgDir, 'dist');

// aws-crt is native (SigV4a for the KeyValueStore), so it ships next to the bundle, not inside it.
const crtVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'node_modules/aws-crt/package.json'), 'utf8')).version;

await build({
  entryPoints: [path.join(pkgDir, 'src/index.ts')],
  outfile: path.join(dist, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['aws-crt'],
  legalComments: 'none',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});

const crtDir = path.join(stage, 'node_modules/aws-crt');
const installed = fs.existsSync(crtDir) && JSON.parse(fs.readFileSync(path.join(crtDir, 'package.json'), 'utf8')).version === crtVersion;
if (!installed) {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'package.json'), '{"private":true}');
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts', `aws-crt@${crtVersion}`], {
    cwd: stage,
    stdio: 'inherit',
  });
  // Lambda runs linux x64 glibc; the other prebuilt binaries are dead weight.
  const bin = path.join(crtDir, 'dist/bin');
  for (const name of fs.readdirSync(bin)) {
    if (name !== 'linux-x64-glibc') fs.rmSync(path.join(bin, name), { recursive: true, force: true });
  }
}

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });

const mtime = new Date(Date.UTC(2020, 0, 1));
const entries = { 'index.mjs': fs.readFileSync(path.join(dist, 'index.mjs')) };
for (const file of walk(path.join(stage, 'node_modules')).sort()) {
  entries[path.relative(stage, file).split(path.sep).join('/')] = fs.readFileSync(file);
}
const zipped = zipSync(
  Object.fromEntries(
    Object.entries(entries).map(([name, data]) => [
      name,
      [data, { mtime, os: 3, attrs: ((name.endsWith('.node') ? 0o100755 : 0o100644) << 16) >>> 0 }],
    ]),
  ),
  { level: 6 },
);

fs.mkdirSync(path.dirname(outZip), { recursive: true });
fs.writeFileSync(outZip, zipped);
const hash = createHash('sha256').update(zipped).digest('hex').slice(0, 16);
console.log(`Wrote ${path.relative(repoRoot, outZip)} (${(zipped.length / 1048576).toFixed(1)} MB, sha256 ${hash})`);
