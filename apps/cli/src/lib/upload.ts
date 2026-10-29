import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import mime from 'mime-types';
import { s3 } from './aws.js';

function listFiles(root: string, dir = root): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(root, full) : [full];
  });
}

// HTML must always revalidate; bundler output in assets/ or static/ is content-hashed.
export function cacheControl(relPath: string): string {
  if (relPath.endsWith('.html')) return 'no-cache';
  if (relPath.startsWith('assets/') || relPath.startsWith('static/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=3600';
}

export async function uploadDirectory(
  bucket: string,
  prefix: string,
  dir: string,
  concurrency = 16,
): Promise<number> {
  const files = listFiles(dir);
  const client = s3();
  let next = 0;

  async function worker(): Promise<void> {
    while (next < files.length) {
      const file = files[next++]!;
      const rel = path.relative(dir, file).split(path.sep).join('/');
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}/${rel}`,
          Body: fs.readFileSync(file),
          ContentType: mime.lookup(file) || 'application/octet-stream',
          CacheControl: cacheControl(rel),
        }),
      );
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return files.length;
}

export async function deletePrefix(bucket: string, prefix?: string): Promise<number> {
  const client = s3();
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
      deleted += keys.length;
    }
    token = page.NextContinuationToken;
  } while (token);
  return deleted;
}

export const emptyBucket = (bucket: string) => deletePrefix(bucket);

/** Deployment ids found in S3 under "<project>/", whether or not they were recorded. */
export async function listDeploymentIds(bucket: string, project: string): Promise<string[]> {
  const client = s3();
  const ids: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${project}/`,
        Delimiter: '/',
        ContinuationToken: token,
      }),
    );
    for (const p of page.CommonPrefixes ?? []) {
      ids.push(p.Prefix!.slice(project.length + 1).replace(/\/$/, ''));
    }
    token = page.NextContinuationToken;
  } while (token);
  return ids;
}

/** Total bytes and object count under a prefix. */
export async function prefixSize(bucket: string, prefix: string): Promise<{ bytes: number; objects: number }> {
  const client = s3();
  let bytes = 0;
  let objects = 0;
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of page.Contents ?? []) {
      bytes += o.Size ?? 0;
      objects += 1;
    }
    token = page.NextContinuationToken;
  } while (token);
  return { bytes, objects };
}
