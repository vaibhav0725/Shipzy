import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { setRoute } from '../lib/kvs.js';
import { readManifest, routeTarget, writeManifest } from '../lib/manifest.js';

export interface RollbackOptions {
  project: string;
  to?: string;
  host?: string;
}

export async function rollback(opts: RollbackOptions, global: GlobalOptions): Promise<void> {
  const out = await getOutputs(global.stackName);
  const host = (opts.host ?? out.domain).toLowerCase();
  const manifest = await readManifest(out.bucket, opts.project);

  let target = opts.to;
  if (!target) {
    const liveId = manifest.live[host];
    const idx = manifest.deployments.findIndex((d) => d.id === liveId);
    if (!liveId || idx < 0) throw new Error(`No live deployment for ${host}; pass --to <id>.`);
    if (idx === 0) throw new Error('This is the oldest deployment; nothing to roll back to.');
    target = manifest.deployments[idx - 1]!.id;
  }
  if (!manifest.deployments.some((d) => d.id === target)) {
    throw new Error(`Deployment ${target} not found. See \`deployer list --project ${opts.project}\`.`);
  }

  await setRoute(out.kvsArn, host, routeTarget(opts.project, target));
  manifest.live[host] = target;
  await writeManifest(out.bucket, manifest);
  console.log(`https://${host} now serves ${target}`);
}
