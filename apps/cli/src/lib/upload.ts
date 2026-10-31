import * as fs from 'node:fs';
import * as path from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '@shipzy/core';
import mime from 'mime-types';

function listFiles(root: string, dir = root): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(root, full) : [full];
  });
}

// HTML must always revalidate; bundler output in assets/, static/ or _next/static/ is content-hashed. Next.js page
// payloads (.txt) are not hashed and change with every build, so they revalidate like HTML.
export function cacheControl(relPath: string): string {
  if (relPath.endsWith('.html')) return 'no-cache';
  if (relPath.startsWith('assets/') || relPath.startsWith('static/') || relPath.startsWith('_next/static/')) {
    return 'public, max-age=31536000, immutable';
  }
  if (relPath.endsWith('.txt') && !relPath.startsWith('_next/')) return 'no-cache';
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
