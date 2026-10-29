import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { assertProjectName } from '../lib/manifest.js';
import { prune } from '../lib/prune.js';

export interface PruneCommandOptions {
  project: string;
  keep: string;
  graceMinutes: string;
  dryRun?: boolean;
}

export async function pruneCommand(opts: PruneCommandOptions, global: GlobalOptions): Promise<void> {
  assertProjectName(opts.project);
  const out = await getOutputs(global.stackName);
  const result = await prune(out, opts.project, {
    keep: Number(opts.keep),
    graceMinutes: Number(opts.graceMinutes),
    dryRun: opts.dryRun,
  });

  const verb = opts.dryRun ? 'Would delete' : 'Deleted';
  for (const id of result.expired) console.log(`${verb} ${id} (beyond the newest ${opts.keep})`);
  for (const id of result.orphans) console.log(`${verb} ${id} (upload that was never promoted)`);
  if (result.expired.length + result.orphans.length === 0) console.log('Nothing to prune.');
}

