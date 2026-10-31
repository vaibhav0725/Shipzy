import { ui } from '../lib/ui.js';
import { projectRoutes, readManifest } from '@shipzy/core';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { formatBytes, table, timeAgo } from '../lib/format.js';
import { listProjects } from '../lib/projects.js';

export interface ListOptions {
  project?: string;
  json?: boolean;
}

export async function list(opts: ListOptions, global: GlobalOptions): Promise<void> {
  const out = await getOutputs(global.stackName);

  if (!opts.project) {
    const projects = await listProjects(out);
    if (opts.json) return console.log(JSON.stringify(projects, null, 2));
    if (projects.length === 0) return console.log('No projects yet. Run `shipzy deploy <dir>`.');

    const rows = projects.map((p) => [
      ui.name(p.name),
      p.live.length ? p.live.map((l) => ui.url(l.host)).join(', ') : ui.dim('- (not live)'),
      p.live[0]?.deploymentId ?? '-',
      timeAgo(p.live[0]?.deployedAt ?? p.lastDeployedAt),
      p.source ? `${p.source.repo}@${p.source.branch}` : '-',
      String(p.versions),
      formatBytes(p.bytes),
      [
        p.domains.length ? `${p.domains.length} domain${p.domains.length === 1 ? '' : 's'}` : '',
        p.envVars ? `${p.envVars} variable${p.envVars === 1 ? '' : 's'}` : '',
        p.source?.previews ? `previews on${p.previews ? ` (${p.previews} open)` : ''}` : '',
      ].filter(Boolean).join(', ') || '-',
    ]);
    console.log(table(['PROJECT', 'LIVE ON', 'LIVE DEPLOYMENT', 'DEPLOYED', 'AUTO-DEPLOY FROM', 'VERSIONS', 'SIZE', 'NOTES'], rows));
    console.log(ui.dim('\nDetails: shipzy list -p <project>'));
    return;
  }

  const [manifest, routing] = await Promise.all([readManifest(out.bucket, opts.project), projectRoutes(out, opts.project)]);
  // What is live is whatever the routing table points at this project, not what the history file last recorded
  // (a host can be taken over by another project, or changed by hand).
  const routes = routing.production;
  manifest.live = Object.fromEntries(routes.map((r) => [r.host, r.target.slice(opts.project!.length + 1)]));
  if (opts.json) return console.log(JSON.stringify(manifest, null, 2));
  if (manifest.deployments.length === 0) {
    console.log(`No deployments for "${opts.project}".`);
    return;
  }
  const liveIds = new Map<string, string[]>();
  for (const [host, id] of Object.entries(manifest.live)) {
    liveIds.set(id, [...(liveIds.get(id) ?? []), host]);
  }
  for (const d of [...manifest.deployments].reverse()) {
    const hosts = liveIds.get(d.id);
    console.log(`${ui.name(d.id)}  ${ui.dim(d.createdAt)}  ${String(d.files).padStart(4)} files${hosts ? `  ${ui.green(`<- live on ${hosts.join(', ')}`)}` : ''}`);
  }
}
