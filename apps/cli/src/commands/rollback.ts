import { ui } from '../lib/ui.js';
import { projectRoutes, readManifest, routeTarget, setRoute, updateManifest } from '@deployer/core';
import { getOutputs, GlobalOptions } from '../lib/aws.js';

export interface RollbackOptions {
  project: string;
  to?: string;
  host?: string;
}

export async function rollback(opts: RollbackOptions, global: GlobalOptions): Promise<void> {
  const out = await getOutputs(global.stackName);
  const manifest = await readManifest(out.bucket, opts.project);

  // A rollback moves what the project is serving right now. That is read from the routing table (the source of
  // truth), never guessed: a project deployed with --host is not on the shared CloudFront address, and rolling
  // back must not put its old version there. Pull request previews are not production hosts and are left alone.
  const owned = (await projectRoutes(out, opts.project)).production;
  const hosts = opts.host ? [opts.host.toLowerCase()] : owned.map((r) => r.host.toLowerCase());
  if (hosts.length === 0) {
    throw new Error(`"${opts.project}" is not live anywhere, so there is nothing to roll back. Pass --host <hostname> --to <id> to serve a deployment.`);
  }

  let target = opts.to;
  if (!target) {
    // The hosts are normally in step; go by the first one that has something live.
    const liveId = owned.find((r) => hosts.includes(r.host.toLowerCase()))?.target.slice(opts.project.length + 1);
    const idx = manifest.deployments.findIndex((d) => d.id === liveId);
    if (!liveId || idx < 0) throw new Error(`No live deployment for ${hosts.join(', ')}; pass --to <id>.`);
    if (idx === 0) throw new Error('This is the oldest deployment; nothing to roll back to.');
    target = manifest.deployments[idx - 1]!.id;
  }
  if (!manifest.deployments.some((d) => d.id === target)) {
    throw new Error(`Deployment ${target} not found. See \`shipzy list --project ${opts.project}\`.`);
  }

  for (const host of hosts) await setRoute(out.kvsArn, host, routeTarget(opts.project, target));
  const liveId = target;
  await updateManifest(out.bucket, opts.project, (m) => {
    for (const host of hosts) m.live[host] = liveId;
  });
  for (const host of hosts) console.log(ui.ok(`${ui.url(`https://${host}`)} now serves ${ui.name(target)}`));
}
