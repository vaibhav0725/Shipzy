import { readManifest, resolveTargetHosts, routeTarget, setRoute, updateManifest } from '@deployer/core';
import { getOutputs, GlobalOptions } from '../lib/aws.js';

export interface RollbackOptions {
  project: string;
  to?: string;
  host?: string;
}

export async function rollback(opts: RollbackOptions, global: GlobalOptions): Promise<void> {
  const out = await getOutputs(global.stackName);
  const manifest = await readManifest(out.bucket, opts.project);
  const hosts = await resolveTargetHosts(out, opts.project, manifest.domains, out.domain, opts.host ? [opts.host] : undefined);

  let target = opts.to;
  if (!target) {
    // The hosts are normally in step; go by the first one that has something live.
    const liveId = hosts.map((h) => manifest.live[h]).find(Boolean);
    const idx = manifest.deployments.findIndex((d) => d.id === liveId);
    if (!liveId || idx < 0) throw new Error(`No live deployment for ${hosts.join(', ')}; pass --to <id>.`);
    if (idx === 0) throw new Error('This is the oldest deployment; nothing to roll back to.');
    target = manifest.deployments[idx - 1]!.id;
  }
  if (!manifest.deployments.some((d) => d.id === target)) {
    throw new Error(`Deployment ${target} not found. See \`deployer list --project ${opts.project}\`.`);
  }

  for (const host of hosts) await setRoute(out.kvsArn, host, routeTarget(opts.project, target));
  const liveId = target;
  await updateManifest(out.bucket, opts.project, (m) => {
    for (const host of hosts) m.live[host] = liveId;
  });
  for (const host of hosts) console.log(`https://${host} now serves ${target}`);
}
