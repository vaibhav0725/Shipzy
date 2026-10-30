// After `next build`, stages the self-contained server twice:
//  - apps/cli/assets/dashboard: used when running from this repository (`deployer dashboard` finds it there; the
//    published CLI package leaves it out);
//  - apps/dashboard/dist-package: the optional package people install on demand (`deployer dashboard` offers to).
// Next's standalone output leaves out the static files, so add those too.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const standalone = path.join(app, '.next/standalone');
const target = path.resolve(app, '../cli/assets/dashboard');

if (!fs.existsSync(path.join(standalone, 'apps/dashboard/server.js'))) {
  throw new Error('Expected .next/standalone/apps/dashboard/server.js; did `next build` run with output: "standalone"?');
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(standalone, target, { recursive: true, dereference: true });
fs.cpSync(path.join(app, '.next/static'), path.join(target, 'apps/dashboard/.next/static'), { recursive: true });

const mb = (fs.readdirSync(target, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).reduce((n, e) => n + fs.statSync(path.join(e.parentPath, e.name)).size, 0) / 1048576).toFixed(0);
console.log(`Staged the dashboard in apps/cli/assets/dashboard (${mb} MB)`);

// The publishable package. npm never packs a folder called node_modules, so those are renamed to _nm here and
// renamed back by the CLI when it installs the package (see apps/cli/src/lib/dashboard-app.ts).
const pkgDir = path.join(app, 'dist-package');
fs.rmSync(pkgDir, { recursive: true, force: true });
fs.cpSync(target, path.join(pkgDir, 'app'), { recursive: true });
const renameModules = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'node_modules') {
      fs.renameSync(full, path.join(dir, '_nm'));
      // Packages inside never contain a nested node_modules that matters beyond one level of renaming, but keep going.
      renameModules(path.join(dir, '_nm'));
    } else {
      renameModules(full);
    }
  }
};
renameModules(path.join(pkgDir, 'app'));
const source = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'));
fs.writeFileSync(
  path.join(pkgDir, 'package.json'),
  JSON.stringify(
    {
      name: source.name,
      version: source.version,
      description: source.description,
      license: source.license,
      private: source.private,
      engines: { node: '>=20' },
      files: ['app'],
    },
    null,
    2,
  ) + '\n',
);
console.log('Staged the installable dashboard package in apps/dashboard/dist-package');
