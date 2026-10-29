import { listManifestProjects, listRoutes, prefixSize, readManifest } from '@deployer/core';
import { StackOutputs } from './aws.js';

export interface LiveHost {
  host: string;
  deploymentId: string;
  deployedAt?: string;
}

export interface ProjectSummary {
  name: string;
  /** hosts currently routed to this project (the routing table is the source of truth) */
  live: LiveHost[];
  versions: number;
  lastDeployedAt?: string;
  bytes: number;
  files: number;
  /** set when pushes to a GitHub branch deploy this project */
  source?: { repo: string; branch: string };
}

export async function listProjects(out: StackOutputs): Promise<ProjectSummary[]> {
  const [names, routes] = await Promise.all([listManifestProjects(out.bucket), listRoutes(out.kvsArn)]);
  // A project can be live without a history file (e.g. its history write failed); still show it.
  const all = new Set([...names, ...routes.map((r) => r.target.split('/')[0]!)]);

  const summaries = await Promise.all(
    [...all].sort().map(async (name): Promise<ProjectSummary> => {
      const [manifest, size] = await Promise.all([readManifest(out.bucket, name), prefixSize(out.bucket, `${name}/`)]);
      const created = new Map(manifest.deployments.map((d) => [d.id, d.createdAt]));
      const live = routes
        .filter((r) => r.target.startsWith(`${name}/`))
        .map((r) => {
          const deploymentId = r.target.slice(name.length + 1);
          return { host: r.host, deploymentId, deployedAt: created.get(deploymentId) };
        });
      return {
        name,
        live,
        versions: manifest.deployments.length,
        lastDeployedAt: manifest.deployments.at(-1)?.createdAt,
        bytes: size.bytes,
        files: size.objects,
        source: manifest.source ? { repo: manifest.source.repo, branch: manifest.source.branch } : undefined,
      };
    }),
  );
  return summaries;
}
