import * as path from 'node:path';
import {
  DEFAULT_GRACE_MINUTES,
  DEFAULT_KEEP,
  discardUpload,
  newDeploymentId,
  prune,
  routeTarget,
  setRoute,
  updateManifest,
} from '@deployer/core';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { build } from '../lib/build.js';
import { parseKeep, resolveProject } from '../lib/project.js';
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
  const host = (opts.host ?? out.domain).toLowerCase();

  const { outDir, framework } = await build(dir, {
    skipBuild: opts.skipBuild ?? false,
    installCommand: opts.installCommand,
    buildCommand: opts.buildCommand,
  });
  console.log(`Deploying ${project} (${framework}) from ${path.relative(process.cwd(), outDir) || outDir}`);

  const keep = parseKeep(opts.keep, DEFAULT_KEEP);

  const id = newDeploymentId();
  const target = routeTarget(project, id);
  let files: number;
  try {
    files = await uploadDirectory(out.bucket, target, outDir);
    console.log(`Uploaded ${files} files as ${id}`);
    // Promote: edge routing first, then record it, so the manifest never claims more than is live.
    await setRoute(out.kvsArn, host, target);
  } catch (err) {
    const outcome = await discardUpload(out, host, target);
    if (outcome === 'removed') console.error('Deploy failed; removed the partial upload.');
    if (outcome === 'failed') {
      console.error('Deploy failed and the partial upload could not be removed; `deployer prune` will clean it up.');
    }
    throw err;
  }

  await updateManifest(out.bucket, project, (m) => {
    m.deployments.push({ id, createdAt: new Date().toISOString(), files });
    m.live[host] = id;
  });

  console.log(`\nLive: https://${host}`);
  console.log('(Routing changes propagate to the edge in roughly 30 seconds.)');

  // Housekeeping must never fail a deploy that already succeeded.
  try {
    const pruned = await prune(out, project, { keep, graceMinutes: DEFAULT_GRACE_MINUTES });
    const count = pruned.expired.length + pruned.orphans.length;
    if (count > 0) console.log(`Cleaned up ${count} old deployment${count === 1 ? '' : 's'} (keeping the newest ${keep}).`);
  } catch (err) {
    console.warn(`Warning: cleanup skipped (${err instanceof Error ? err.message : err}). Run \`deployer prune\` later.`);
  }
}
