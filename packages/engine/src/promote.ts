import { HeadObjectCommand } from '@aws-sdk/client-s3';
import {
  assertProjectName,
  DEFAULT_GRACE_MINUTES,
  DEFAULT_KEEP,
  discardUpload,
  prune,
  readManifest,
  resolveTargetHosts,
  routeTarget,
  s3,
  setMode,
  setRoute,
  updateManifest,
} from '@shipzy/core';
import { env } from './env.js';
import {
  previewFailed,
  promotePreview,
  removePreviewFor,
  type PreviewFailedEvent,
  type PreviewPromoteEvent,
  type PreviewRemoveEvent,
} from './preview.js';

export interface PromoteEvent {
  action: 'promote';
  project: string;
  id: string;
  preview?: undefined;
  /** hosts to make live; when absent, the project's domains (else the CloudFront URL) */
  hosts?: string[];
  /** older callers send a single host */
  host?: string;
  keep?: number;
  /** number of files the build uploaded */
  files: number;
  /** what the project was built as, and how the edge must serve it (see core's framework.ts) */
  framework?: string;
  routing?: 'html' | 'dir';
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
export async function promote(event: PromoteEvent | PreviewPromoteEvent | PreviewRemoveEvent | PreviewFailedEvent) {
  if (event.action === 'preview-remove') return removePreviewFor(event);
  if (event.action === 'preview-failed') return previewFailed(event);
  if ('preview' in event && event.preview) return promotePreview(event);
  return promoteProduction(event as PromoteEvent);
}

async function promoteProduction(event: PromoteEvent) {
  const site = { bucket: env('SITES_BUCKET'), kvsArn: env('KVS_ARN') };
  assertProjectName(event.project);
  if (!ID_RE.test(event.id)) throw new Error(`Invalid deployment id "${event.id}"`);

  const explicit = event.hosts?.length ? event.hosts : event.host ? [event.host] : undefined;
  const hosts = await resolveTargetHosts(
    site,
    event.project,
    await readManifest(site.bucket, event.project),
    env('DEFAULT_HOST'),
    explicit,
  );
  const target = routeTarget(event.project, event.id);
  const keep = Number.isInteger(event.keep) && event.keep! >= 1 ? event.keep! : DEFAULT_KEEP;

  try {
    await assertUploaded(site.bucket, target);
    // The routing style first: a host must never point at a multi-page site while the router still treats it as a SPA.
    if (event.routing) await setMode(site.kvsArn, target, event.routing);
    for (const host of hosts) await setRoute(site.kvsArn, host, target);
  } catch (err) {
    await discardUpload(site, hosts, target);
    throw err;
  }

  await updateManifest(site.bucket, event.project, (m) => {
    if (!m.deployments.some((d) => d.id === event.id)) {
      m.deployments.push({ id: event.id, createdAt: new Date().toISOString(), files: event.files, framework: event.framework, routing: event.routing });
    }
    for (const host of hosts) m.live[host] = event.id;
  });

  // Housekeeping must never fail a deploy that already succeeded.
  let pruned = 0;
  try {
    const result = await prune(site, event.project, { keep, graceMinutes: DEFAULT_GRACE_MINUTES });
    pruned = result.expired.length + result.orphans.length;
  } catch (err) {
    console.warn('cleanup skipped', err);
  }

  const urls = hosts.map((h) => `https://${h}`);
  return { ok: true, project: event.project, id: event.id, hosts, url: urls[0], urls, pruned };
}
