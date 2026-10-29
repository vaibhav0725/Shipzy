import {
  assertProjectName,
  listManifestProjects,
  listRoutes,
  readManifest,
  readPreviewBases,
  removePreview,
} from '@deployer/core';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { table, timeAgo } from '../lib/format.js';

export async function previewsList(opts: { project?: string; json?: boolean }, global: GlobalOptions): Promise<void> {
  const out = await getOutputs(global.stackName);
  const [bases, routes, names] = await Promise.all([readPreviewBases(out.bucket), listRoutes(out.kvsArn), listManifestProjects(out.bucket)]);
  const hosts = new Set(routes.map((r) => r.host));

  const previews = [];
  for (const project of opts.project ? [opts.project] : names) {
    const manifest = await readManifest(out.bucket, project);
    for (const [pr, info] of Object.entries(manifest.previews ?? {})) {
      previews.push({
        project,
        pr: Number(pr),
        host: info.host,
        url: `https://${info.host}`,
        deployment: info.id,
        sha: info.sha,
        updatedAt: info.updatedAt,
        serving: hosts.has(info.host),
      });
    }
  }
  previews.sort((a, b) => a.project.localeCompare(b.project) || a.pr - b.pr);

  if (opts.json) return console.log(JSON.stringify({ bases, previews }, null, 2));
  if (bases.length === 0) {
    console.log('No preview domain is set up. Add one with: deployer domain add "*.preview.<your domain>" --preview');
  } else {
    console.log(`Preview domain${bases.length === 1 ? '' : 's'}: ${bases.map((b) => `*.${b}`).join(', ')}`);
  }
  if (previews.length === 0) return console.log('No open previews.');
  console.log(
    table(
      ['PROJECT', 'PR', 'URL', 'COMMIT', 'UPDATED'],
      previews.map((p) => [p.project, `#${p.pr}`, p.serving ? p.url : `${p.url} (not served)`, p.sha.slice(0, 7), timeAgo(p.updatedAt)]),
    ),
  );
}

export async function previewsRemove(prArg: string, opts: { project: string }, global: GlobalOptions): Promise<void> {
  assertProjectName(opts.project);
  const pr = Number(prArg.replace(/^#/, ''));
  if (!Number.isInteger(pr) || pr < 1) throw new Error(`"${prArg}" is not a pull request number.`);
  const out = await getOutputs(global.stackName);
  const removed = await removePreview(out, opts.project, pr);
  console.log(removed ? `Removed the preview of ${opts.project} #${pr}.` : `${opts.project} has no preview for #${pr}.`);
}
