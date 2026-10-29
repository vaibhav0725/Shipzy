import { StackOutputs } from './aws.js';
import { listRouteTargets } from './kvs.js';
import { readManifest, routeTarget, writeManifest } from './manifest.js';
import { deletePrefix, listDeploymentIds } from './upload.js';

export const DEFAULT_KEEP = 10;
export const DEFAULT_GRACE_MINUTES = 60;

export interface PruneOptions {
  /** newest recorded deployments to keep (live ones are always kept on top of this) */
  keep: number;
  /** unrecorded uploads younger than this are left alone: they may be a deploy in progress */
  graceMinutes: number;
  dryRun?: boolean;
}

export interface PruneResult {
  expired: string[];
  orphans: string[];
}

// Ids look like d-20261028T212416-f8ca7f; the timestamp is UTC.
function idTimestamp(id: string): number | undefined {
  const m = /^d-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})-[0-9a-f]+$/.exec(id);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

export async function prune(out: StackOutputs, project: string, opts: PruneOptions): Promise<PruneResult> {
  if (!Number.isInteger(opts.keep) || opts.keep < 1) throw new Error('--keep must be a whole number >= 1.');

  const manifest = await readManifest(out.bucket, project);

  // Never delete anything a host is routed to, even if the manifest doesn't know about it.
  const routed = await listRouteTargets(out.kvsArn);
  const isProtected = (id: string) =>
    Object.values(manifest.live).includes(id) || routed.has(routeTarget(project, id));

  const newest = new Set(manifest.deployments.slice(-opts.keep).map((d) => d.id));
  const expired = manifest.deployments.filter((d) => !newest.has(d.id) && !isProtected(d.id)).map((d) => d.id);

  const recorded = new Set(manifest.deployments.map((d) => d.id));
  const cutoff = Date.now() - opts.graceMinutes * 60_000;
  const orphans = (await listDeploymentIds(out.bucket, project)).filter((id) => {
    const ts = idTimestamp(id);
    return !recorded.has(id) && !isProtected(id) && ts !== undefined && ts <= cutoff;
  });

  if (opts.dryRun || (expired.length === 0 && orphans.length === 0)) return { expired, orphans };

  // Drop records first: a leftover object is harmless (the next sweep catches it),
  // but a record without objects would make a rollback serve nothing.
  if (expired.length > 0) {
    manifest.deployments = manifest.deployments.filter((d) => !expired.includes(d.id));
    await writeManifest(out.bucket, manifest);
  }
  for (const id of [...expired, ...orphans]) {
    await deletePrefix(out.bucket, `${routeTarget(project, id)}/`);
  }
  return { expired, orphans };
}
