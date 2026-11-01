import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// How the hosted functions call the CLI that is packaged beside them (cli/shipzy.mjs).

export const cliFile = () => process.env.SHIPZY_CLI ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli', 'shipzy.mjs');

/** The stack and region the dashboard was deployed for. */
export function cliArgs(): string[] {
  let stackName = 'Deployer';
  try {
    if (process.env.SHIPZY_GLOBALS) stackName = (JSON.parse(process.env.SHIPZY_GLOBALS) as { stackName?: string }).stackName ?? stackName;
  } catch {
    /* keep the default */
  }
  return ['--stack-name', stackName];
}

/** The function's own environment, minus what belongs to the dashboard server, plus a step's extras. */
export function cliEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: '/tmp', NO_COLOR: '1' };
  for (const name of Object.keys(env)) {
    if (name === 'NODE_ENV' || name === 'PORT' || name === 'HOSTNAME' || name.startsWith('NEXT_') || name.startsWith('SHIPZY_') || name === 'AWS_LAMBDA_RUNTIME_API') delete env[name];
  }
  delete env.FORCE_COLOR;
  return { ...env, ...extra };
}
