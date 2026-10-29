import { engineKeyOf, findStack, GlobalOptions, readOutputs, whoAmI } from '../lib/aws.js';
import { formatBytes } from '../lib/format.js';
import { listProjects } from '../lib/projects.js';

export async function status(opts: { json?: boolean }, global: GlobalOptions): Promise<void> {
  const me = await whoAmI();
  const stack = await findStack(global.stackName);
  if (!stack) throw new Error(`Stack "${global.stackName}" not found. Run \`deployer init\` first.`);
  const out = readOutputs(stack);
  const projects = await listProjects(out);

  const summary = {
    account: me.account,
    identity: me.arn,
    region: process.env.AWS_REGION,
    stack: { name: global.stackName, status: stack.StackStatus, updated: stack.LastUpdatedTime ?? stack.CreationTime },
    bucket: out.bucket,
    distribution: { id: out.distributionId, url: `https://${out.domain}` },
    builds: { project: out.buildProject, engine: Boolean(engineKeyOf(stack)), webhookUrl: out.webhookUrl },
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
    ['Projects', `${summary.projects} (${summary.liveSites} live)`],
    ['Deployments', `${summary.deployments} stored, ${formatBytes(summary.bytes)}`],
  ];
  for (const [k, v] of rows) console.log(`${k.padEnd(12)}${v}`);
}
