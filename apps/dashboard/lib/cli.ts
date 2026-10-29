import { spawn } from 'node:child_process';
import { settings } from './config';

/** Options every CLI call gets, so the dashboard acts on the same profile, region and stack it was started with. */
export function globalArgs(): string[] {
  const { globals } = settings();
  return [
    ...(globals.profile ? ['--profile', globals.profile] : []),
    ...(globals.region ? ['--region', globals.region] : []),
    '--stack-name',
    globals.stackName,
  ];
}

/** The process to run for a CLI command. Always an argument array: no shell is ever involved. */
export function cliCommand(args: string[]): { file: string; argv: string[] } {
  return { file: process.execPath, argv: [settings().cli, ...globalArgs(), ...args] };
}

/**
 * The environment a CLI process gets. It is this server's environment minus what belongs to the server itself:
 * NODE_ENV=production would make `npm install` skip the dev dependencies a build needs, PORT and HOSTNAME are the
 * server's listen address, and the access token must never reach a project's build scripts.
 */
export function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name === 'NODE_ENV' || name === 'PORT' || name === 'HOSTNAME' || name.startsWith('NEXT_') || name.startsWith('__NEXT_') || name.startsWith('DEPLOYER_DASH')) {
      delete env[name];
    }
  }
  return { ...env, ...extra };
}

export class CliError extends Error {}

const cache = new Map<string, { at: number; value: Promise<unknown> }>();
export const clearCache = () => cache.clear();

function run(args: string[]): Promise<string> {
  const { file, argv } = cliCommand(args);
  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (err += d));
    child.on('error', (e) => reject(new CliError(`Could not start the deployer CLI: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) return resolve(out);
      const message = (err.trim() || out.trim()).replace(/^Error:\s*/, '').split('\n').filter(Boolean).slice(-3).join(' ');
      reject(new CliError(message || `The command failed (exit ${code}).`));
    });
  });
}

/** Runs a read-only CLI command that prints JSON (`--json`). Results are cached briefly, so a page that asks
 *  for the same thing twice, or two browser tabs, do not each start an AWS round trip. */
export function runJson<T>(args: string[], ttlMs = 4000): Promise<T> {
  const key = args.join('\0');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = run(args).then((text) => JSON.parse(text) as T);
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}
