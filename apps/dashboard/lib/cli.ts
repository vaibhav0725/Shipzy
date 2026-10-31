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
  // The dashboard's logs are plain text: never let the CLI colour its output, whatever the user's shell sets.
  delete env.FORCE_COLOR;
  env.NO_COLOR = '1';
  return { ...env, ...extra };
}

export class CliError extends Error {}

// Results are kept on globalThis because Next may load this module more than once (routes, instrumentation).
interface Entry {
  at: number;
  value?: unknown;
  refreshing?: Promise<unknown>;
}
const g = globalThis as unknown as { __deployerCache?: Map<string, Entry> };
const cache = (g.__deployerCache ??= new Map<string, Entry>());

/** After a change (a finished job), what was read before may be wrong: drop it and read the common pages again. */
export function clearCache(): void {
  cache.clear();
  warm();
}

/** The reads every page starts with, fetched ahead of time so the first page opens from memory. */
export function warm(): void {
  for (const [args, ttl] of [
    [['status', '--json'], 4000],
    [['list', '--json'], 4000],
    [['domain', 'ls', '--json'], 8000],
  ] as const) {
    runJson([...args], ttl).catch(() => undefined);
  }
}

function run(args: string[]): Promise<string> {
  const { file, argv } = cliCommand(args);
  return new Promise((resolve, reject) => {
    const child = spawn(file, argv, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (err += d));
    child.on('error', (e) => reject(new CliError(`Could not start the shipzy CLI: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) return resolve(out);
      const message = (err.trim() || out.trim()).replace(/^Error:\s*/, '').split('\n').filter(Boolean).slice(-3).join(' ');
      reject(new CliError(message || `The command failed (exit ${code}).`));
    });
  });
}

/** Past this age a result is not shown any more, even while a new one is being read. */
const MAX_STALE_MS = 10 * 60_000;

/**
 * Runs a read-only CLI command that prints JSON (`--json`). Every read costs a few seconds of AWS round trips, so a
 * result younger than `ttlMs` is returned as is, an older one is returned at once while a fresh read runs in the
 * background (the page's next poll shows it), and only a first read has to wait.
 */
export function runJson<T>(args: string[], ttlMs = 4000): Promise<T> {
  const key = args.join('\0');
  const entry = cache.get(key) ?? { at: 0 };
  cache.set(key, entry);

  const age = Date.now() - entry.at;
  const refresh = (): Promise<unknown> =>
    (entry.refreshing ??= run(args)
      .then((text) => {
        entry.value = JSON.parse(text);
        entry.at = Date.now();
        return entry.value;
      })
      .finally(() => {
        entry.refreshing = undefined;
      }));

  if (entry.value !== undefined && age < ttlMs) return Promise.resolve(entry.value as T);
  if (entry.value !== undefined && age < MAX_STALE_MS) {
    refresh().catch(() => undefined);
    return Promise.resolve(entry.value as T);
  }
  const fresh = refresh() as Promise<T>;
  fresh.catch(() => cache.delete(key));
  return fresh;
}
