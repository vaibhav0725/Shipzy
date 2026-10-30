import { ui, uiErr } from '../lib/ui.js';
import * as path from 'node:path';
import {
  DEFAULT_GRACE_MINUTES,
  DEFAULT_KEEP,
  discardUpload,
  newDeploymentId,
  prune,
  readManifest,
  resolveTargetHosts,
  routeTarget,
  setRoute,
  updateManifest,
} from '@deployer/core';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { build } from '../lib/build.js';
import { parseKeep, resolveProject } from '../lib/project.js';
import { ensureProjectSite } from '../lib/sites.js';
import { uploadDirectory } from '../lib/upload.js';
import { remoteDeploy } from './remote-deploy.js';

export interface DeployOptions {
  project?: string;
  host?: string;
  skipBuild?: boolean;
  installCommand?: string;
  buildCommand?: string;
  keep?: string;
  /** build in CodeBuild in the user's account instead of on this machine */
  remote?: boolean;
  /** with --remote: start the build and return without waiting */
  detach?: boolean;
}

export async function deploy(dirArg: string, opts: DeployOptions, global: GlobalOptions): Promise<void> {
  if (opts.remote) return remoteDeploy(dirArg, opts, global);
  if (opts.detach) throw new Error('--detach only applies to remote builds (add --remote).');

  const dir = path.resolve(dirArg);
  const project = resolveProject(dir, opts.project);

  const out = await getOutputs(global.stackName);
  const explicit = opts.host ? [opts.host] : undefined;
  await ensureProjectSite(out, global, project, explicit);
  const hosts = await resolveTargetHosts(out, project, await readManifest(out.bucket, project), out.domain, explicit);

  const { outDir, framework } = await build(dir, {
    skipBuild: opts.skipBuild ?? false,
    installCommand: opts.installCommand,
    buildCommand: opts.buildCommand,
  });
  console.log(ui.step(`Deploying ${ui.name(project)} (${framework}) from ${path.relative(process.cwd(), outDir) || outDir}`));

  const keep = parseKeep(opts.keep, DEFAULT_KEEP);

  const id = newDeploymentId();
  const target = routeTarget(project, id);
  let files: number;
  try {
    files = await uploadDirectory(out.bucket, target, outDir);
    console.log(ui.step(`Uploaded ${files} files as ${ui.dim(id)}`));
    // Promote: edge routing first, then record it, so the manifest never claims more than is live.
    for (const host of hosts) await setRoute(out.kvsArn, host, target);
  } catch (err) {
    const outcome = await discardUpload(out, hosts, target);
    if (outcome === 'removed') console.error(uiErr.red('Deploy failed; removed the partial upload.'));
    if (outcome === 'failed') {
      console.error(uiErr.red('Deploy failed and the partial upload could not be removed; `deployer prune` will clean it up.'));
    }
    throw err;
  }

  await updateManifest(out.bucket, project, (m) => {
    m.deployments.push({ id, createdAt: new Date().toISOString(), files });
    for (const host of hosts) m.live[host] = id;
  });

  console.log(`\n${ui.ok(ui.bold(ui.green('Live:')))} ${hosts.map((h) => ui.url(`https://${h}`)).join(', ')}`);
  console.log(ui.dim('(Routing changes propagate to the edge in roughly 30 seconds.)'));

  // Housekeeping must never fail a deploy that already succeeded.
  try {
    const pruned = await prune(out, project, { keep, graceMinutes: DEFAULT_GRACE_MINUTES });
    const count = pruned.expired.length + pruned.orphans.length;
    if (count > 0) console.log(ui.dim(`Cleaned up ${count} old deployment${count === 1 ? '' : 's'} (keeping the newest ${keep}).`));
  } catch (err) {
    console.warn(`${uiErr.yellow('Warning:')} cleanup skipped (${err instanceof Error ? err.message : err}). Run \`deployer prune\` later.`);
  }
}
