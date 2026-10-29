import { HeadObjectCommand } from '@aws-sdk/client-s3';
import {
  assertProjectName,
  DEFAULT_GRACE_MINUTES,
  DEFAULT_KEEP,
  discardUpload,
  prune,
  routeTarget,
  s3,
  setRoute,
  updateManifest,
} from '@deployer/core';
import { env } from './env.js';

export interface PromoteEvent {
  action: 'promote';
  project: string;
  id: string;
  host?: string;
  keep?: number;
  /** number of files the build uploaded */
  files: number;
}

const ID_RE = /^d-\d{8}T\d{6}-[0-9a-f]{6}$/;

// Refuse to promote an upload that is missing or empty.
async function assertUploaded(bucket: string, target: string): Promise<void> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: `${target}/index.html` }));
  } catch (err) {
    if ((err as { name?: string }).name === 'NotFound') {
      throw new Error(`Nothing to promote: s3://${bucket}/${target}/index.html does not exist.`);
    }
    throw err;
  }
}

/**
 * Called by the build once a deployment folder is fully uploaded: point the host at it,
 * record it, then prune. Same order as the CLI's `deploy`.
 */
export async function promote(event: PromoteEvent) {
  const site = { bucket: env('SITES_BUCKET'), kvsArn: env('KVS_ARN') };
  assertProjectName(event.project);
  if (!ID_RE.test(event.id)) throw new Error(`Invalid deployment id "${event.id}"`);

  const host = (event.host || env('DEFAULT_HOST')).toLowerCase();
  const target = routeTarget(event.project, event.id);
  const keep = Number.isInteger(event.keep) && event.keep! >= 1 ? event.keep! : DEFAULT_KEEP;

  try {
    await assertUploaded(site.bucket, target);
    await setRoute(site.kvsArn, host, target);
  } catch (err) {
    await discardUpload(site, host, target);
    throw err;
  }

  await updateManifest(site.bucket, event.project, (m) => {
    if (!m.deployments.some((d) => d.id === event.id)) {
      m.deployments.push({ id: event.id, createdAt: new Date().toISOString(), files: event.files });
    }
    m.live[host] = event.id;
  });

  // Housekeeping must never fail a deploy that already succeeded.
  let pruned = 0;
  try {
    const result = await prune(site, event.project, { keep, graceMinutes: DEFAULT_GRACE_MINUTES });
    pruned = result.expired.length + result.orphans.length;
  } catch (err) {
    console.warn('cleanup skipped', err);
  }

  return { ok: true, project: event.project, id: event.id, host, url: `https://${host}`, pruned };
}
