import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import {
  assertProjectName,
  DEFAULT_GRACE_MINUTES,
  DEFAULT_KEEP,
  discardUpload,
  getPullRequest,
  prune,
  PREVIEW_COMMENT_MARKER,
  previewHost,
  readManifest,
  readPreviewBases,
  removePreview,
  routeTarget,
  s3,
  setMode,
  setRoute,
  updateManifest,
  upsertComment,
} from '@deployer/core';
import { env } from './env.js';

const ID_RE = /^d-\d{8}T\d{6}-[0-9a-f]{6}$/;

export interface PreviewPromoteEvent {
  action: 'promote';
  project: string;
  id: string;
  keep?: number;
  files: number;
  preview: { pr: number; sha: string };
  framework?: string;
  routing?: 'html' | 'dir';
}

export interface PreviewRemoveEvent {
  action: 'preview-remove';
  project: string;
  pr: number;
}

export interface PreviewFailedEvent {
  action: 'preview-failed';
  project: string;
  pr: number;
  sha: string;
}

const site = () => ({ bucket: env('SITES_BUCKET'), kvsArn: env('KVS_ARN') });

async function githubToken(): Promise<string> {
  const value = (await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: env('GITHUB_TOKEN_SECRET_ARN') })))
    .SecretString;
  if (!value) throw new Error('The GitHub token secret is empty.');
  return value;
}

function assertPullRequest(pr: unknown): asserts pr is number {
  if (!Number.isInteger(pr) || (pr as number) < 1) throw new Error(`Invalid pull request number "${String(pr)}"`);
}

/** A comment is a courtesy: failing to post one (token without pull request access, rate limit) never fails the preview. */
async function comment(token: string, repo: string, pr: number, body: string): Promise<void> {
  try {
    await upsertComment(token, repo, pr, PREVIEW_COMMENT_MARKER, body);
  } catch (err) {
    console.warn(`Could not comment on ${repo}#${pr}: ${err instanceof Error ? err.message : err}`);
  }
}

async function previewSource(project: string) {
  const manifest = await readManifest(site().bucket, project);
  if (manifest.source?.type !== 'github' || !manifest.source.previews) {
    throw new Error(`"${project}" is not set up for pull request previews.`);
  }
  return { manifest, repo: manifest.source.repo };
}

/** Called by a preview build once its folder is uploaded: serve it on the pull request's own hostname. */
export async function promotePreview(event: PreviewPromoteEvent) {
  const { bucket, kvsArn } = site();
  assertProjectName(event.project);
  if (!ID_RE.test(event.id)) throw new Error(`Invalid deployment id "${event.id}"`);
  const { pr, sha } = event.preview;
  assertPullRequest(pr);

  const { repo } = await previewSource(event.project);
  const base = (await readPreviewBases(bucket))[0];
  if (!base) throw new Error('No preview domain is set up. Add one with: shipzy domain add "*.preview.<your domain>" --preview');
  const host = previewHost(event.project, pr, base);
  const target = routeTarget(event.project, event.id);
  const token = await githubToken();

  // The pull request is the source of truth: a build for a closed pull request, or for a commit that is no longer
  // its head (a newer push is on the way), must not go live.
  const stale = async (): Promise<string | undefined> => {
    const pull = await getPullRequest(token, repo, pr);
    if (pull.state !== 'open') return 'the pull request is closed';
    if (pull.head.sha !== sha) return 'a newer commit has been pushed';
    return undefined;
  };
  const skip = await stale().catch(async (err) => {
    await discardUpload({ bucket, kvsArn }, host, target);
    throw err;
  });
  if (skip) {
    await discardUpload({ bucket, kvsArn }, host, target);
    return { ok: true, skipped: skip, project: event.project, pr };
  }

  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: `${target}/index.html` }));
    if (event.routing) await setMode(kvsArn, target, event.routing);
    await setRoute(kvsArn, host, target);
  } catch (err) {
    await discardUpload({ bucket, kvsArn }, host, target);
    throw err;
  }

  await updateManifest(bucket, event.project, (m) => {
    m.deployments.push({ id: event.id, createdAt: new Date().toISOString(), files: event.files, preview: pr, framework: event.framework, routing: event.routing });
    m.previews = { ...m.previews, [String(pr)]: { host, id: event.id, sha, updatedAt: new Date().toISOString() } };
  });

  // The pull request may have been closed while this ran, with its close event arriving before the route existed.
  const after = await getPullRequest(token, repo, pr).catch(() => undefined);
  if (after && after.state !== 'open') {
    await removePreview({ bucket, kvsArn }, event.project, pr);
    return { ok: true, skipped: 'the pull request was closed meanwhile', project: event.project, pr };
  }

  await comment(
    token,
    repo,
    pr,
    `**Preview ready**\n\nhttps://${host}\n\nBuilt from \`${sha.slice(0, 7)}\`. It is updated on every push and removed when this pull request is closed.`,
  );

  let pruned = 0;
  try {
    const result = await prune({ bucket, kvsArn }, event.project, {
      keep: Number.isInteger(event.keep) && event.keep! >= 1 ? event.keep! : DEFAULT_KEEP,
      graceMinutes: DEFAULT_GRACE_MINUTES,
    });
    pruned = result.expired.length + result.orphans.length;
  } catch (err) {
    console.warn('cleanup skipped', err);
  }
  return { ok: true, project: event.project, id: event.id, pr, hosts: [host], url: `https://${host}`, urls: [`https://${host}`], pruned };
}

/** The pull request was closed: take its preview down and say so on the pull request. */
export async function removePreviewFor(event: PreviewRemoveEvent) {
  assertProjectName(event.project);
  assertPullRequest(event.pr);
  const removed = await removePreview(site(), event.project, event.pr);
  if (removed) {
    const { repo } = await previewSource(event.project).catch(() => ({ repo: undefined }));
    if (repo) await comment(await githubToken(), repo, event.pr, '**Preview removed** because this pull request was closed.');
  }
  return { ok: true, project: event.project, pr: event.pr, removed };
}

/** The preview build failed before it could be promoted. */
export async function previewFailed(event: PreviewFailedEvent) {
  assertProjectName(event.project);
  assertPullRequest(event.pr);
  const { repo } = await previewSource(event.project);
  const token = await githubToken();
  const pull = await getPullRequest(token, repo, event.pr).catch(() => undefined);
  // Only the latest commit's result is worth reporting.
  if (pull && pull.state === 'open' && pull.head.sha === event.sha) {
    await comment(
      token,
      repo,
      event.pr,
      `**Preview build failed** for \`${event.sha.slice(0, 7)}\`.\n\nSee the log with \`shipzy builds -p ${event.project}\` and \`shipzy logs <build>\`. The previous preview, if there was one, is still being served.`,
    );
  }
  return { ok: true, project: event.project, pr: event.pr };
}
