import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { assetPath } from './assets.js';

// The dashboard is optional. It is a separate package (about 50 MB installed) that `shipzy dashboard` installs
// into ~/.shipzy/dashboard-app the first time it is wanted, so people who only use the CLI never download it.
// Inside this repository the build leaves a copy in assets/dashboard, which is used as is.

declare const __DEPLOYER_VERSION__: string | undefined;
declare const __DASHBOARD_PACKAGE__: string | undefined;

const version = typeof __DEPLOYER_VERSION__ === 'undefined' ? undefined : __DEPLOYER_VERSION__;
const packageName = typeof __DASHBOARD_PACKAGE__ === 'undefined' ? 'shipzy-dashboard' : __DASHBOARD_PACKAGE__;

/** Where the optional package is installed. */
export const installDir = () => path.join(os.homedir(), '.shipzy', 'dashboard-app');
const packageDir = () => path.join(installDir(), 'node_modules', ...packageName.split('/'));

const SERVER = 'apps/dashboard/server.js';

const installedServer = () => path.join(packageDir(), 'app', SERVER);

function installedVersion(): string | undefined {
  try {
    return (JSON.parse(fs.readFileSync(path.join(packageDir(), 'package.json'), 'utf8')) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/** The dashboard server file to run, if one is available and matches this CLI's version. */
export function locateDashboard(): string | undefined {
  const override = process.env.DEPLOYER_DASHBOARD_DIR;
  if (override) return fs.existsSync(path.join(override, SERVER)) ? path.join(override, SERVER) : undefined;
  const bundled = path.join(assetPath('dashboard'), SERVER);
  if (fs.existsSync(bundled)) return bundled;
  if (fs.existsSync(installedServer()) && (!version || installedVersion() === version)) return installedServer();
  return undefined;
}

// npm does not pack folders named node_modules, so the package carries them as _nm; put the name back.
function restoreModules(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === '_nm') {
      const real = path.join(dir, 'node_modules');
      fs.rmSync(real, { recursive: true, force: true });
      fs.renameSync(full, real);
      restoreModules(real);
    } else {
      restoreModules(full);
    }
  }
}

function runNpm(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' });
    child.on('error', (err) => reject(new Error(`Could not run npm (${err.message}). Install Node.js with npm, then try again.`)));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm exited with code ${code}.`))));
  });
}

/** Downloads the dashboard package for this CLI's version into ~/.shipzy/dashboard-app. */
export async function installDashboard(): Promise<string> {
  const dir = installDir();
  fs.mkdirSync(dir, { recursive: true });
  const manifest = path.join(dir, 'package.json');
  if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, JSON.stringify({ name: 'deployer-dashboard-app', private: true }) + '\n');
  // DEPLOYER_DASHBOARD_PACKAGE lets a local tarball or another version be used (testing, offline installs).
  const spec = process.env.DEPLOYER_DASHBOARD_PACKAGE ?? `${packageName}@${version ?? 'latest'}`;
  console.log(`Installing the dashboard (${spec}) into ${dir} ...`);
  await runNpm(['install', '--prefix', dir, '--no-audit', '--no-fund', '--loglevel=error', spec]);
  restoreModules(path.join(packageDir(), 'app'));
  if (!fs.existsSync(installedServer())) throw new Error(`The dashboard package was installed but ${SERVER} is missing from it.`);
  return installedServer();
}

async function askYes(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/**
 * Finds the dashboard, or offers to install it (people who decline keep a small install). `install` skips the
 * question. Without a terminal there is nobody to ask, so the command to run is printed instead.
 */
export async function ensureDashboard(install: boolean): Promise<string> {
  const found = install ? undefined : locateDashboard();
  if (found) return found;

  if (!install) {
    const stale = fs.existsSync(installedServer()) ? ` (the installed one is ${installedVersion() ?? 'unknown'}, this CLI is ${version})` : '';
    const how = 'shipzy dashboard --install';
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(`The local dashboard is an optional download and is not installed${stale}. Install it with: ${how}`);
    }
    console.log(`The local dashboard is an optional extra (about 50 MB) and is not installed${stale}.`);
    if (!(await askYes('Download and install it now?'))) {
      throw new Error(`Not installed. You can do it later with: ${how}  (the CLI works fully without it).`);
    }
  }
  return installDashboard();
}
