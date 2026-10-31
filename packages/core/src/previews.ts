import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from './clients.js';
import { deleteMode, deleteRoute, listRoutes } from './kvs.js';
import { readManifest, routeTarget, updateManifest, type Manifest } from './manifest.js';
import { deletePrefix } from './objects.js';
import { SiteRefs } from './types.js';

/** Hidden marker that identifies the comment this tool keeps on a pull request. */
export const PREVIEW_COMMENT_MARKER = '<!-- deployer-preview -->';

const META_KEY = '.deployer-meta/previews.json';

/** Wildcard domains previews are served on ("preview.example.com" for `*.preview.example.com`). */
interface PreviewSettings {
  bases: string[];
}

async function loadSettings(bucket: string): Promise<{ settings: PreviewSettings; etag?: string }> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: META_KEY }));
    const parsed = JSON.parse((await res.Body?.transformToString()) ?? '') as Partial<PreviewSettings>;
    return { settings: { bases: parsed.bases ?? [] }, etag: res.ETag };
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return { settings: { bases: [] } };
    throw err;
  }
}

export async function readPreviewBases(bucket: string): Promise<string[]> {
  return (await loadSettings(bucket)).settings.bases;
}

/** Records (or forgets) a base domain. Rare and operator-driven, so a plain read-modify-write is enough. */
export async function updatePreviewBases(bucket: string, mutate: (bases: string[]) => string[]): Promise<string[]> {
  const { settings, etag } = await loadSettings(bucket);
  const bases = [...new Set(mutate(settings.bases).map((b) => b.toLowerCase()))].sort();
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: META_KEY,
      Body: JSON.stringify({ bases }, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-store',
      ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
    }),
  );
  return bases;
}

/** DNS labels are at most 63 characters, and the label is "<project>-pr-<number>". */
export function previewLabel(project: string, pr: number): string {
  const label = `${project}-pr-${pr}`;
  if (label.length > 63) {
    throw new Error(`"${label}" is longer than 63 characters, so it cannot be a hostname; use a shorter project name.`);
  }
  return label;
}

export const previewHost = (project: string, pr: number, base: string): string =>
  `${previewLabel(project, pr)}.${base.toLowerCase()}`;

/** Is this host served by a preview base domain? (`*.preview.example.com` covers `x.preview.example.com`.) */
export function isPreviewHost(host: string, bases: string[]): boolean {
  const h = host.toLowerCase();
  return bases.some((b) => h.endsWith(`.${b.toLowerCase()}`));
}

/**
 * Routes that serve a project in production, leaving out its pull request previews.
 * Rollback, the live-on column and similar views must not treat a preview as a production host.
 */
export async function projectRoutes(site: SiteRefs, project: string): Promise<{ production: { host: string; target: string }[]; previews: { host: string; target: string }[] }> {
  const [routes, bases] = await Promise.all([listRoutes(site.kvsArn), readPreviewBases(site.bucket)]);
  const owned = routes.filter((r) => r.target.startsWith(`${project}/`));
  return {
    production: owned.filter((r) => !isPreviewHost(r.host, bases)),
    previews: owned.filter((r) => isPreviewHost(r.host, bases)),
  };
}

/**
 * Takes one pull request's preview down: its route, its history entry and its files. Safe to repeat.
 * Returns false when there was nothing to remove.
 */
export async function removePreview(site: SiteRefs, project: string, pr: number): Promise<boolean> {
  const manifest = await readManifest(site.bucket, project);
  const info = manifest.previews?.[String(pr)];
  const ids = new Set(manifest.deployments.filter((d) => d.preview === pr).map((d) => d.id));
  if (info) ids.add(info.id);
  if (!info && ids.size === 0) return false;

  // Route first, so nothing serves files that are about to disappear.
  if (info) await deleteRoute(site.kvsArn, info.host).catch(() => undefined);
  await updateManifest(site.bucket, project, (m: Manifest) => {
    delete m.previews?.[String(pr)];
    if (m.previews && Object.keys(m.previews).length === 0) delete m.previews;
    m.deployments = m.deployments.filter((d) => d.preview !== pr);
    if (info) delete m.live[info.host];
  });
  for (const id of ids) {
    await deletePrefix(site.bucket, `${routeTarget(project, id)}/`);
    await deleteMode(site.kvsArn, routeTarget(project, id)).catch(() => undefined);
  }
  return true;
}
