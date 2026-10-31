import * as path from 'node:path';

export interface Globals {
  profile?: string;
  region?: string;
  stackName: string;
}

/** What `shipzy dashboard` passes to this server through the environment. */
export function settings() {
  let globals: Globals = { stackName: 'Deployer' };
  try {
    if (process.env.SHIPZY_GLOBALS) globals = { ...globals, ...JSON.parse(process.env.SHIPZY_GLOBALS) };
  } catch {
    /* keep the defaults */
  }
  return {
    // In development (`next dev`) fall back to the CLI built in this repository.
    cli: process.env.SHIPZY_CLI ?? path.resolve(process.cwd(), '../cli/dist/shipzy.mjs'),
    cwd: process.env.SHIPZY_CWD ?? process.env.HOME ?? process.cwd(),
    globals,
  };
}
