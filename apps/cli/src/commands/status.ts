import { engineKeyOf, findStack, GlobalOptions, readOutputs, whoAmI } from '../lib/aws.js';
import { duration, envOf, recentBuilds } from '../lib/builds.js';
import { formatBytes, timeAgo } from '../lib/format.js';
import { readPreviewBases } from '@deployer/core';
import { listProjects } from '../lib/projects.js';

export async function status(opts: { json?: boolean }, global: GlobalOptions): Promise<void> {
  const [me, stack] = await Promise.all([whoAmI(), findStack(global.stackName)]);
  if (!stack) throw new Error(`Stack "${global.stackName}" not found. Run \`deployer init\` first.`);
  const out = readOutputs(stack);
  const [projects, [lastBuild], previewDomains] = await Promise.all([
    listProjects(out),
    out.buildProject ? recentBuilds(out.buildProject, 1) : Promise.resolve([]),
    readPreviewBases(out.bucket),
  ]);

  const summary = {
    account: me.account,
    identity: me.arn,
    region: process.env.AWS_REGION,
    stack: { name: global.stackName, status: stack.StackStatus, updated: stack.LastUpdatedTime ?? stack.CreationTime },
    bucket: out.bucket,
    distribution: { id: out.distributionId, url: `https://${out.domain}` },
    builds: {
      project: out.buildProject,
      engine: Boolean(engineKeyOf(stack)),
      webhookUrl: out.webhookUrl,
      last: lastBuild
        ? { status: lastBuild.buildStatus, project: envOf(lastBuild, 'DEPLOY_PROJECT'), startedAt: lastBuild.startTime, took: duration(lastBuild) }
        : undefined,
    },
    githubProjects: projects.filter((p) => p.source).length,
    domains: projects.reduce((n, p) => n + p.domains.length, 0),
    previewDomains,
    openPreviews: projects.reduce((n, p) => n + p.previews, 0),
    envVars: projects.reduce((n, p) => n + p.envVars, 0),
    projects: projects.length,
    deployments: projects.reduce((n, p) => n + p.versions, 0),
    liveSites: projects.reduce((n, p) => n + p.live.length, 0),
    bytes: projects.reduce((n, p) => n + p.bytes, 0),
  };
  if (opts.json) return console.log(JSON.stringify(summary, null, 2));

  const rows: [string, string][] = [
    ['Account', `${summary.account} (${summary.identity})`],
    ['Region', summary.region ?? '-'],
    ['Stack', `${summary.stack.name}  ${summary.stack.status}`],
    ['Bucket', summary.bucket],
    ['CloudFront', `${summary.distribution.id}  ${summary.distribution.url}`],
    ['Builds', summary.builds.engine ? `${out.buildProject} (engine installed)` : 'not set up: run `deployer init`'],
    ['Webhook', out.webhookUrl ?? '-'],
    ['GitHub', `${summary.githubProjects} project(s) deploy on push`],
    [
      'Last build',
      summary.builds.last
        ? `${summary.builds.last.status}  ${summary.builds.last.project ?? '-'}  ${timeAgo(summary.builds.last.startedAt?.toISOString())}  (${summary.builds.last.took})`
        : 'none yet',
    ],
    ['Domains', `${summary.domains} custom${summary.previewDomains.length ? `; previews on ${summary.previewDomains.map((d) => `*.${d}`).join(', ')} (${summary.openPreviews} open)` : ''}`],
    ['Variables', `${summary.envVars} build-time variable${summary.envVars === 1 ? '' : 's'} across projects`],
    ['Projects', `${summary.projects} (${summary.liveSites} live)`],
    ['Deployments', `${summary.deployments} stored, ${formatBytes(summary.bytes)}`],
  ];
  for (const [k, v] of rows) console.log(`${k.padEnd(12)}${v}`);
}
