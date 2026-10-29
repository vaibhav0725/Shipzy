import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { s3 } from './aws.js';

export interface Deployment {
  id: string;
  createdAt: string;
  files: number;
}

export interface Manifest {
  project: string;
  deployments: Deployment[];
  /** host -> id of the live deployment */
  live: Record<string, string>;
}

export const MANIFEST_PREFIX = '.deployer/';
const key = (project: string) => `${MANIFEST_PREFIX}${project}.json`;

export async function readManifest(bucket: string, project: string): Promise<Manifest> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key(project) }));
    return JSON.parse((await res.Body?.transformToString()) ?? '') as Manifest;
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') {
      return { project, deployments: [], live: {} };
    }
    throw err;
  }
}

export async function writeManifest(bucket: string, manifest: Manifest): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key(manifest.project),
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-store',
    }),
  );
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
