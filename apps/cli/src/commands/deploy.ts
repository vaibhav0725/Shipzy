import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { build, readPackageJson } from '../lib/build.js';
import { getRoute, setRoute } from '../lib/kvs.js';
import {
  assertProjectName,
  readManifest,
  routeTarget,
  writeManifest,
} from '../lib/manifest.js';
import { DEFAULT_GRACE_MINUTES, DEFAULT_KEEP, prune } from '../lib/prune.js';
import { deletePrefix, uploadDirectory } from '../lib/upload.js';

export interface DeployOptions {
  project?: string;
  host?: string;
  skipBuild?: boolean;
  installCommand?: string;
  buildCommand?: string;
  keep?: string;
}

const sanitize = (s: string) =>
  s.toLowerCase().replace(/^@[^/]+\//, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

function newDeploymentId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  return `d-${stamp}-${randomBytes(3).toString('hex')}`;
}

export async function deploy(dirArg: string, opts: DeployOptions, global: GlobalOptions): Promise<void> {
  const dir = path.resolve(dirArg);
  const project = opts.project ?? sanitize(readPackageJson(dir).name ?? path.basename(dir));
  assertProjectName(project);

  const out = await getOutputs(global.stackName);
  const host = (opts.host ?? out.domain).toLowerCase();

  const { outDir, framework } = await build(dir, {
    skipBuild: opts.skipBuild ?? false,
    installCommand: opts.installCommand,
    buildCommand: opts.buildCommand,
  });
  console.log(`Deploying ${project} (${framework}) from ${path.relative(process.cwd(), outDir) || outDir}`);

  const keep = Number(opts.keep ?? DEFAULT_KEEP);
  if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be a whole number >= 1.');

  const id = newDeploymentId();
  const target = routeTarget(project, id);
  let files: number;
  try {
    files = await uploadDirectory(out.bucket, target, outDir);
    console.log(`Uploaded ${files} files as ${id}`);
    // Promote: edge routing first, then record it, so the manifest never claims more than is live.
    await setRoute(out.kvsArn, host, target);
  } catch (err) {
    await discardUpload(out.bucket, out.kvsArn, host, target);
    throw err;
  }

  const manifest = await readManifest(out.bucket, project);
  manifest.deployments.push({ id, createdAt: new Date().toISOString(), files });
  manifest.live[host] = id;
  await writeManifest(out.bucket, manifest);

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

// A failed deploy must not leave its upload behind. The one exception: if the route already
// points at it (e.g. the promote call succeeded but its response was lost), deleting would take the site down.
async function discardUpload(bucket: string, kvsArn: string, host: string, target: string): Promise<void> {
  try {
    if ((await getRoute(kvsArn, host)) === target) return;
    await deletePrefix(bucket, `${target}/`);
    console.error('Deploy failed; removed the partial upload.');
  } catch {
    console.error('Deploy failed and the partial upload could not be removed; `deployer prune` will clean it up.');
  }
}
