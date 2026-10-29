import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { s3 } from './clients.js';

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
