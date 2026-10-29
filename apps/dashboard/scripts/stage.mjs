// After `next build`: copies the self-contained server into the CLI package (apps/cli/assets/dashboard), where
// `deployer dashboard` finds and runs it. Next's standalone output leaves out the static files, so add those too.
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
