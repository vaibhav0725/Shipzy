import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { s3 } from './clients.js';

export interface Deployment {
  id: string;
  createdAt: string;
  files: number;
}

export interface GithubSource {
  type: 'github';
  /** "owner/name" */
  repo: string;
  branch: string;
  /** host to promote to; default is the CloudFront domain */
  host?: string;
  /** replace the detected install/build step, as with `deploy --install-command` */
  installCommand?: string;
  buildCommand?: string;
}

export interface Manifest {
  project: string;
  deployments: Deployment[];
  /** host -> id of the live deployment */
  live: Record<string, string>;
  /** where pushes come from, when the project is connected to GitHub */
  source?: GithubSource;
}

export const MANIFEST_PREFIX = '.deployer/';
const key = (project: string) => `${MANIFEST_PREFIX}${project}.json`;

interface Loaded {
  manifest: Manifest;
  /** undefined when the manifest does not exist yet */
  etag?: string;
}

async function load(bucket: string, project: string): Promise<Loaded> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key(project) }));
    return { manifest: JSON.parse((await res.Body?.transformToString()) ?? '') as Manifest, etag: res.ETag };
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') {
      return { manifest: { project, deployments: [], live: {} } };
    }
    throw err;
  }
}

export async function readManifest(bucket: string, project: string): Promise<Manifest> {
  return (await load(bucket, project)).manifest;
}

function isConflict(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === 'PreconditionFailed' ||
    e.name === 'ConditionalRequestConflict' ||
    e.$metadata?.httpStatusCode === 412 ||
    e.$metadata?.httpStatusCode === 409
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read-modify-write that is safe when several deploys finish at once (concurrent builds):
 * the write only succeeds if nobody changed the manifest since it was read, otherwise it
 * re-reads and applies `mutate` again.
 */
export async function updateManifest(
  bucket: string,
  project: string,
  mutate: (manifest: Manifest) => void,
  attempts = 8,
): Promise<Manifest> {
  for (let attempt = 1; ; attempt++) {
    const { manifest, etag } = await load(bucket, project);
    mutate(manifest);
    try {
      await s3().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key(project),
          Body: JSON.stringify(manifest, null, 2),
          ContentType: 'application/json',
          CacheControl: 'no-store',
          ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
        }),
      );
      return manifest;
    } catch (err) {
      if (!isConflict(err) || attempt >= attempts) throw err;
      await sleep(25 * attempt + Math.random() * 75 * attempt);
    }
  }
}

export async function listManifestProjects(bucket: string): Promise<string[]> {
  const names: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: MANIFEST_PREFIX, ContinuationToken: token }),
    );
    for (const o of page.Contents ?? []) {
      if (o.Key?.endsWith('.json')) names.push(o.Key.slice(MANIFEST_PREFIX.length, -'.json'.length));
    }
    token = page.NextContinuationToken;
  } while (token);
  return names;
}

export async function deleteManifest(bucket: string, project: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key(project) }));
}

export const routeTarget = (project: string, id: string) => `${project}/${id}`;

const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export function assertProjectName(name: string): void {
  if (!PROJECT_RE.test(name)) {
    throw new Error(`Invalid project name "${name}": use lowercase letters, digits and dashes.`);
  }
}
