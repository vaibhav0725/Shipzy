import * as path from 'node:path';

export interface Globals {
  profile?: string;
  region?: string;
  stackName: string;
}

/** What `deployer dashboard` passes to this server through the environment. */
export function settings() {
  let globals: Globals = { stackName: 'Deployer' };
  try {
    if (process.env.DEPLOYER_GLOBALS) globals = { ...globals, ...JSON.parse(process.env.DEPLOYER_GLOBALS) };
  } catch {
    /* keep the defaults */
  }
  return {
    // In development (`next dev`) fall back to the CLI built in this repository.
    cli: process.env.DEPLOYER_CLI ?? path.resolve(process.cwd(), '../cli/dist/deployer.mjs'),
    cwd: process.env.DEPLOYER_CWD ?? process.env.HOME ?? process.cwd(),
    globals,
  };
}
